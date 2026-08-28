//! In-protocol enforcement of device certificates.
//!
//! `device.rs` can verify a certificate; this makes MLS itself refuse a leaf
//! whose certificate doesn't check out. That distinction matters: with
//! verification left to the caller, one forgetful call site admits an
//! unauthenticated device. Here it is structural — a leaf cannot enter a group
//! without the account key having signed it.
//!
//! It also supplies the **stable identity** MLS uses to decide whether two
//! leaves are the same member across an update. We return the ACCOUNT key, not
//! the device key, so a device rotating its signature key stays the same person
//! (`docs/03-identity-and-crypto.md` §1).

use mls_rs::{
    error::IntoAnyError,
    identity::{Credential, CredentialType, SigningIdentity},
    time::MlsTime,
    ExtensionList, IdentityProvider,
};

use mls_rs_core::identity::MemberValidationContext;

use crate::device::{CertError, DeviceCert};

#[derive(Debug, Clone, Default)]
pub struct DeviceCertIdentityProvider;

#[derive(Debug, thiserror::Error)]
pub enum IdentityError {
    #[error("credential is not a device certificate")]
    WrongCredentialType,
    #[error(transparent)]
    Cert(#[from] CertError),
    /// The certificate is validly signed, but for a different key than the one
    /// this leaf actually signs with — i.e. someone re-presenting a real
    /// certificate over their own key.
    #[error("device certificate does not cover this leaf's signature key")]
    KeyMismatch,
}

impl IntoAnyError for IdentityError {
    fn into_dyn_error(self) -> Result<Box<dyn std::error::Error + Send + Sync>, Self> {
        Ok(self.into())
    }
}

fn check(signing_identity: &SigningIdentity) -> Result<DeviceCert, IdentityError> {
    let Credential::Basic(basic) = &signing_identity.credential else {
        return Err(IdentityError::WrongCredentialType);
    };
    let cert = DeviceCert::decode(&basic.identifier)?;
    cert.verify()?;

    // The signature proves the account vouched for `cert.device_pub`. Without
    // this check, an attacker could take someone else's valid certificate and
    // present it alongside their own signature key.
    if cert.device_pub != signing_identity.signature_key.as_bytes() {
        return Err(IdentityError::KeyMismatch);
    }
    Ok(cert)
}

impl IdentityProvider for DeviceCertIdentityProvider {
    type Error = IdentityError;

    fn validate_member(
        &self,
        signing_identity: &SigningIdentity,
        _timestamp: Option<MlsTime>,
        _context: MemberValidationContext<'_>,
    ) -> Result<(), Self::Error> {
        check(signing_identity).map(|_| ())
    }

    fn validate_external_sender(
        &self,
        signing_identity: &SigningIdentity,
        _timestamp: Option<MlsTime>,
        _extensions: Option<&ExtensionList>,
    ) -> Result<(), Self::Error> {
        // The Host acts as an external sender for membership proposals
        // (`docs/03` §5). It presents a device certificate like anyone else.
        check(signing_identity).map(|_| ())
    }

    /// The DEVICE key, which must be unique per leaf.
    ///
    /// This was originally the account key, on the reasoning that two devices
    /// of one person "are" the same member. MLS disagreed, loudly: it uses this
    /// value to detect duplicate members, so both of an account's devices
    /// looked like one member and the second Add failed with
    /// `DuplicateLeafData`. Per-device leaves are the entire point of the
    /// design (`docs/03` §1), so identity is per device and the
    /// same-person relation lives in `valid_successor` below instead.
    fn identity(
        &self,
        signing_identity: &SigningIdentity,
        _extensions: &ExtensionList,
    ) -> Result<Vec<u8>, Self::Error> {
        Ok(check(signing_identity)?.device_pub)
    }

    /// Where "same person" actually belongs: a leaf may replace another only
    /// when both certificates were signed by the same account key. So a device
    /// can rotate its signature key and stay itself, and cannot silently become
    /// somebody else.
    fn valid_successor(
        &self,
        predecessor: &SigningIdentity,
        successor: &SigningIdentity,
        _extensions: &ExtensionList,
    ) -> Result<bool, Self::Error> {
        Ok(check(predecessor)?.account_pub == check(successor)?.account_pub)
    }

    fn supported_types(&self) -> Vec<CredentialType> {
        vec![CredentialType::BASIC]
    }
}

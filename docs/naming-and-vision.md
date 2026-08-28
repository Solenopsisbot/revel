# Naming and Vision

## Name Candidates

**Haunt** -- Your usual haunt. The place you keep going back to. It's got a whiff of the uncanny about it (ghosts, haunted houses) which is honestly kind of perfect for a platform where AI friends and plural headmates are just people in the room. One syllable, easy to verb ("haunt me later"), and it sounds like somewhere you'd actually want to be. No known collision with major software.
*Gut check: Sounds like a place. Sounds a little mischievous. Does not sound like a compliance product.*

**Hollow** -- A sheltered valley. "Meet me in the Hollow." It's got a strong place-name quality -- Sleepy Hollow, the hollow in the woods behind your house. Suggests somewhere naturally enclosed, private without being fortified. Two syllables that feel like one. No known collision.
*Gut check: Sounds like a real place you'd name. Warm. Slightly mythic.*

**Hearth** -- Where people gather, where the fire is. The oldest social technology, really: sit around the warm thing and talk. One syllable. No known collision with chat software, though it's common enough as a word that smaller things probably use it.
*Gut check: Warm, maybe a little earnest. Could read as cozy or as precious depending on the design around it.*

**Cove** -- A naturally sheltered bay. Privacy metaphor without the crypto-bro energy. One syllable, coastal, relaxed. "The Cove" is already how people refer to favorite spots. There are some products called Cove (a security company, I think) but nothing dominant in chat.
*Gut check: Sounds like a place you'd actually go. Breezy. Could skew too casual for what's underneath.*

**Murmur** -- Soft conversation, private speech. Also: a murmuration, hundreds of starlings moving as one -- many individuals, one shape. The plural-systems resonance there is almost too good. Two syllables that flow easily. No known chat-app collision.
*Gut check: Beautiful word. "Send me a murmur" is a little awkward as a verb, though. More evocative than practical.*

**Roost** -- Where you settle in. Where different birds share the same tree. One syllable, animal-warmth, suggests coming home. No known collision.
*Gut check: Unpretentious. Friendly. Maybe slightly too cute? Works better if the brand leans playful.*

**Bower** -- A sheltered place in a garden. Also: the bowerbird, which decorates its home elaborately to attract others. One syllable, poetic but not fussy. No known collision.
*Gut check: Distinctive. Might need explaining to people who don't know the word, which is either a problem or a feature.*

**Glade** -- A clearing in the woods. Open and bright but surrounded by something that shields it. One syllable. No collision I'm aware of.
*Gut check: Peaceful. Maybe too peaceful -- doesn't have much personality on its own.*

**Thicket** -- Dense growth, hard to see through from outside. Natural privacy, not architectural privacy. Two syllables. No known collision.
*Gut check: Has texture. Sounds a little wild. Might connote "impenetrable" more than "welcoming," which is the wrong trade.*

**Burrow** -- Underground, cozy, interconnected tunnels. Suggests warrens of rooms, hidden by nature rather than by walls. Two syllables. No known collision.
*Gut check: Extremely cozy. Good plural resonance (many rooms, one home). Could read as "hiding" rather than "choosing who sees you."*

**Perch** -- Where you sit and watch. Light, casual, one syllable. No major collision.
*Gut check: Fun, airy. Maybe too slight for the weight of what this actually is.*

**Cairn** -- A stone marker left for the people who come after you. Wayfinding. One syllable, distinctive. No known collision in chat.
*Gut check: Interesting and specific, but sounds more like a dev tool than a place you'd hang out. Slightly enterprise-adjacent.*

**Dwell** -- To inhabit, to live somewhere. One syllable, verb-as-name. Dwell is an architecture/design magazine, which is a soft collision but different domain.
*Gut check: The magazine collision is annoying. The word itself is great -- "where do you dwell?" But the name might feel too literary.*

**Vesper** -- Evening. Twilight. The hour when you settle in and talk. Two syllables, atmospheric. James Bond's Vesper Lynd means the word has some cultural charge. No software collision.
*Gut check: Gorgeous word. Slightly formal? Would need the product around it to keep things loose.*

**Grove** -- A small stand of trees. Community of living things, naturally bounded. One syllable. Probably some minor collisions (it's a common word for product names) but nothing dominant in chat.
*Gut check: Communal, alive. Not very distinctive -- it blends in more than it stands out.*

**Canopy** -- Overhead shelter. The layer that protects what's underneath. Three syllables, which is pushing it. There might be business software called Canopy.
*Gut check: Good metaphor but slightly too polished. Sounds more like a startup than a hangout.*

### Top 3

**Haunt.** It's my first pick and it's not close. The word does triple duty: it's a place you frequent ("my usual haunt"), it's got that spectral quality that nods at the AI-friends-and-headmates thing without making a big deal of it, and it's inherently casual -- nobody haunts a boardroom. It verbs naturally, it's one syllable, and it has personality. Most importantly, it doesn't sound like it's trying to sell you privacy. It sounds like it's trying to be somewhere worth going.

**Hollow.** The strongest "place name" of the bunch. Hollow has a specific, almost geographic feel -- you could point to a Hollow on a map. That matters for something that wants to be a *place* rather than a *service*. The word also has a nice double meaning: naturally sheltered, but also "hollow" as in the server is hollow, it can't see what's inside it.

**Murmur.** The most beautiful word on the list and the one with the deepest plural resonance (murmuration -- many moving as one). It's the riskiest pick because it's harder to verb and it's softer than the others. But if the product earns it, there's nothing else like it.

---

## Vision

Here is the thing about every chat platform you've ever used: the company that runs it can read your messages. All of them. Every late-night conversation, every group chat about your terrible landlord, every DM where you told someone something true. The server has the plaintext. Someone at the company could look. In a breach, an attacker gets it. Under a subpoena, the government gets it. You're trusting the operator to be decent about this, and maybe they are decent, but the architecture doesn't require them to be, and eventually architecture is the only thing that matters.

We're building a chat platform where the server is a blind relay. Every room is end-to-end encrypted. There is no cleartext path, no "enterprise mode" that disables it, no flag a sysadmin can flip. The server stores ciphertext and moves it around. It doesn't know what you said and it can't find out. This is the load-bearing wall; everything else is built on top of it.

What does "everything else" look like? It looks like Discord, honestly. Servers, channels, voice, roles, permissions, DMs, bots, the whole apparatus that makes a chat platform something people actually live in rather than something they reluctantly install because someone told them to. We're not building a new paradigm. The paradigm is fine. We're building it on an honest foundation.

A few things are different, though, because we're different.

Your identity is a keypair. You own it; nobody issues it to you. A handle -- the human-readable name people see -- lives with an identity provider, which by default is us but can be anyone. You can move your handle without losing your identity, because the cryptographic you is not the same as the name-tag you. Self-hosted servers can accept identities from any provider they choose to trust, which means communities can run their own infrastructure without asking permission, and their members don't have to create new accounts to do it.

One account can have many faces. We call them that because "identity" is already doing too much work in this paragraph, but what we mean is: if you're part of a plural system, you shouldn't need five accounts and a bot to be yourself. One login, many names, many avatars, many sets of pronouns. You switch between them the way you switch between them in life. This isn't a feature -- it's how accounts work. Similarly, the people in your rooms who happen to be AI aren't "integrations" or "apps" bolted on from the side. They're members. Same presence, same permissions, same roster. If a bot can read a room, it shows up in the member list, because "no ghost readers" is a promise, and a bot that silently ingests your encrypted messages would be a lie.

There is one hosted service for people who just want to sign up and talk. But the server is a single self-hostable binary, because the only honest way to say "we can't read your messages" is to let you verify that by running the same code yourself. No message federation between servers -- Matrix tried that and what they got was a distributed-systems PhD thesis masquerading as a chat app, where message ordering is an open research problem and your encryption keys break if you look at them wrong. A community's messages live on that community's server. You want to be in two communities, you connect to two servers. Simple in the way that's actually simple, not in the way that's simple to describe and nightmarish to implement.

Honest about what we can't do: if the server can't read your messages, the server can't search them for you, can't build a spam filter on them, can't auto-moderate them, can't translate them server-side. Those things either happen on your device, happen via a bot that's visibly in the room, or don't happen. That's a real cost. We think it's worth paying, but we're not going to pretend you're not paying it. Similarly: end-to-end encryption protects your messages from the operator and from a database breach. It does not protect them from the person you sent them to. If someone saw a message, they can screenshot it. No technology fixes that and anyone who tells you otherwise is selling something.

This is not a "privacy app." We don't have a manifesto and we're not going to put a padlock in the logo. It's a chat platform where the architecture is honest about who can see what. You shouldn't have to care about privacy to deserve it -- it should just be how the building is constructed, the same way you don't think about whether your apartment walls are load-bearing until someone tries to remove one. They're there. They hold things up. You live your life.

We want to build the place where you'd actually want to spend time -- fast, well-designed, full of the small touches that make a platform feel alive -- and also the place where the walls are real. Those two things shouldn't be in tension and it's honestly kind of bizarre that, in 2026, they still are.

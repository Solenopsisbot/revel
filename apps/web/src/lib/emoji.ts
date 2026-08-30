/**
 * The emoji set.
 *
 * GENERATED — see the `python3` block in the commit that added this file.
 * Search keywords come from the Unicode character names of each codepoint, so
 * every emoji is findable by the words that officially describe it rather than
 * by whatever 1148 guesses I would otherwise have had to write by hand.
 *
 * This is the ONE place in the product where emoji are allowed to appear
 * (`docs/07`): inside the picker, and in the reactions people choose with it.
 * Chrome uses drawn icons — see `Icon.svelte`.
 */

export interface Emoji {
  /** The character itself. */
  c: string;
  /** Search terms, lowercased, from the Unicode names. */
  k: string[];
}

export interface EmojiGroup {
  id: string;
  label: string;
  /** Whether the group's emoji accept a skin-tone modifier. */
  tone: boolean;
  items: Emoji[];
}

/** Fitzpatrick modifiers, in the order the tone row shows them. */
export const TONES = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'] as const;
export type Tone = number;

export const GROUPS: EmojiGroup[] = [
  {
    id: 'people',
    label: 'Smileys & people',
    tone: false,
    items: [
      {
        c: '😀',
        k: ['grinning', 'face'],
      },
      {
        c: '😃',
        k: ['smiling', 'face', 'open', 'mouth'],
      },
      {
        c: '😄',
        k: ['smiling', 'face', 'open', 'mouth', 'eyes'],
      },
      {
        c: '😁',
        k: ['grinning', 'face', 'smiling', 'eyes'],
      },
      {
        c: '😆',
        k: ['smiling', 'face', 'open', 'mouth', 'tightly', 'closed'],
      },
      {
        c: '😅',
        k: ['smiling', 'face', 'open', 'mouth', 'cold', 'sweat'],
      },
      {
        c: '🤣',
        k: ['rolling', 'floor', 'laughing'],
      },
      {
        c: '😂',
        k: ['face', 'tears', 'joy'],
      },
      {
        c: '🙂',
        k: ['slightly', 'smiling', 'face'],
      },
      {
        c: '🙃',
        k: ['upside', 'down', 'face'],
      },
      {
        c: '😉',
        k: ['winking', 'face'],
      },
      {
        c: '😊',
        k: ['smiling', 'face', 'eyes'],
      },
      {
        c: '😇',
        k: ['smiling', 'face', 'halo'],
      },
      {
        c: '🥰',
        k: ['smiling', 'face', 'eyes', 'three', 'hearts'],
      },
      {
        c: '😍',
        k: ['smiling', 'face', 'heart', 'shaped', 'eyes'],
      },
      {
        c: '🤩',
        k: ['grinning', 'face', 'star', 'eyes'],
      },
      {
        c: '😘',
        k: ['face', 'throwing', 'kiss'],
      },
      {
        c: '😗',
        k: ['kissing', 'face'],
      },
      {
        c: '😚',
        k: ['kissing', 'face', 'closed', 'eyes'],
      },
      {
        c: '😙',
        k: ['kissing', 'face', 'smiling', 'eyes'],
      },
      {
        c: '🥲',
        k: ['smiling', 'face', 'tear'],
      },
      {
        c: '😋',
        k: ['face', 'savouring', 'delicious', 'food'],
      },
      {
        c: '😛',
        k: ['face', 'stuck', 'out', 'tongue'],
      },
      {
        c: '😜',
        k: ['face', 'stuck', 'out', 'tongue', 'winking', 'eye'],
      },
      {
        c: '🤪',
        k: ['grinning', 'face', 'one', 'large', 'small', 'eye'],
      },
      {
        c: '😝',
        k: ['face', 'stuck', 'out', 'tongue', 'tightly', 'closed'],
      },
      {
        c: '🤑',
        k: ['money', 'mouth', 'face'],
      },
      {
        c: '🤗',
        k: ['hugging', 'face'],
      },
      {
        c: '🤭',
        k: ['smiling', 'face', 'eyes', 'hand', 'covering', 'mouth'],
      },
      {
        c: '🤫',
        k: ['face', 'finger', 'covering', 'closed', 'lips'],
      },
      {
        c: '🤔',
        k: ['thinking', 'face'],
      },
      {
        c: '🤐',
        k: ['zipper', 'mouth', 'face'],
      },
      {
        c: '🤨',
        k: ['face', 'one', 'eyebrow', 'raised'],
      },
      {
        c: '😐',
        k: ['neutral', 'face'],
      },
      {
        c: '😑',
        k: ['expressionless', 'face'],
      },
      {
        c: '😶',
        k: ['face', 'without', 'mouth'],
      },
      {
        c: '😏',
        k: ['smirking', 'face'],
      },
      {
        c: '😒',
        k: ['unamused', 'face'],
      },
      {
        c: '🙄',
        k: ['face', 'rolling', 'eyes'],
      },
      {
        c: '😬',
        k: ['grimacing', 'face'],
      },
      {
        c: '🤥',
        k: ['lying', 'face'],
      },
      {
        c: '😌',
        k: ['relieved', 'face'],
      },
      {
        c: '😔',
        k: ['pensive', 'face'],
      },
      {
        c: '😪',
        k: ['sleepy', 'face'],
      },
      {
        c: '🤤',
        k: ['drooling', 'face'],
      },
      {
        c: '😴',
        k: ['sleeping', 'face'],
      },
      {
        c: '😷',
        k: ['face', 'medical', 'mask'],
      },
      {
        c: '🤒',
        k: ['face', 'thermometer'],
      },
      {
        c: '🤕',
        k: ['face', 'head', 'bandage'],
      },
      {
        c: '🤢',
        k: ['nauseated', 'face'],
      },
      {
        c: '🤮',
        k: ['face', 'open', 'mouth', 'vomiting'],
      },
      {
        c: '🤧',
        k: ['sneezing', 'face'],
      },
      {
        c: '🥵',
        k: ['overheated', 'face'],
      },
      {
        c: '🥶',
        k: ['freezing', 'face'],
      },
      {
        c: '🥴',
        k: ['face', 'uneven', 'eyes', 'wavy', 'mouth'],
      },
      {
        c: '😵',
        k: ['dizzy', 'face'],
      },
      {
        c: '🤯',
        k: ['shocked', 'face', 'exploding', 'head'],
      },
      {
        c: '🤠',
        k: ['face', 'cowboy', 'hat'],
      },
      {
        c: '🥳',
        k: ['face', 'party', 'horn', 'hat'],
      },
      {
        c: '🥸',
        k: ['disguised', 'face'],
      },
      {
        c: '😎',
        k: ['smiling', 'face', 'sunglasses'],
      },
      {
        c: '🤓',
        k: ['nerd', 'face'],
      },
      {
        c: '🧐',
        k: ['face', 'monocle'],
      },
      {
        c: '😕',
        k: ['confused', 'face'],
      },
      {
        c: '😟',
        k: ['worried', 'face'],
      },
      {
        c: '🙁',
        k: ['slightly', 'frowning', 'face'],
      },
      {
        c: '😮',
        k: ['face', 'open', 'mouth'],
      },
      {
        c: '😯',
        k: ['hushed', 'face'],
      },
      {
        c: '😲',
        k: ['astonished', 'face'],
      },
      {
        c: '😳',
        k: ['flushed', 'face'],
      },
      {
        c: '🥺',
        k: ['face', 'pleading', 'eyes'],
      },
      {
        c: '😦',
        k: ['frowning', 'face', 'open', 'mouth'],
      },
      {
        c: '😧',
        k: ['anguished', 'face'],
      },
      {
        c: '😨',
        k: ['fearful', 'face'],
      },
      {
        c: '😰',
        k: ['face', 'open', 'mouth', 'cold', 'sweat'],
      },
      {
        c: '😥',
        k: ['disappointed', 'but', 'relieved', 'face'],
      },
      {
        c: '😢',
        k: ['crying', 'face'],
      },
      {
        c: '😭',
        k: ['loudly', 'crying', 'face'],
      },
      {
        c: '😱',
        k: ['face', 'screaming', 'fear'],
      },
      {
        c: '😖',
        k: ['confounded', 'face'],
      },
      {
        c: '😣',
        k: ['persevering', 'face'],
      },
      {
        c: '😞',
        k: ['disappointed', 'face'],
      },
      {
        c: '😓',
        k: ['face', 'cold', 'sweat'],
      },
      {
        c: '😩',
        k: ['weary', 'face'],
      },
      {
        c: '😫',
        k: ['tired', 'face'],
      },
      {
        c: '🥱',
        k: ['yawning', 'face'],
      },
      {
        c: '😤',
        k: ['face', 'look', 'triumph'],
      },
      {
        c: '😡',
        k: ['pouting', 'face'],
      },
      {
        c: '😠',
        k: ['angry', 'face'],
      },
      {
        c: '🤬',
        k: ['serious', 'face', 'symbols', 'covering', 'mouth'],
      },
      {
        c: '😈',
        k: ['smiling', 'face', 'horns'],
      },
      {
        c: '👿',
        k: ['imp'],
      },
      {
        c: '💀',
        k: ['skull'],
      },
      {
        c: '💩',
        k: ['pile', 'poo'],
      },
      {
        c: '🤡',
        k: ['clown', 'face'],
      },
      {
        c: '👻',
        k: ['ghost'],
      },
      {
        c: '👽',
        k: ['extraterrestrial', 'alien'],
      },
      {
        c: '🤖',
        k: ['robot', 'face'],
      },
      {
        c: '😺',
        k: ['smiling', 'cat', 'face', 'open', 'mouth'],
      },
      {
        c: '😸',
        k: ['grinning', 'cat', 'face', 'smiling', 'eyes'],
      },
      {
        c: '😹',
        k: ['cat', 'face', 'tears', 'joy'],
      },
      {
        c: '😻',
        k: ['smiling', 'cat', 'face', 'heart', 'shaped', 'eyes'],
      },
      {
        c: '😼',
        k: ['cat', 'face', 'wry', 'smile'],
      },
      {
        c: '😽',
        k: ['kissing', 'cat', 'face', 'closed', 'eyes'],
      },
      {
        c: '🙀',
        k: ['weary', 'cat', 'face'],
      },
      {
        c: '😿',
        k: ['crying', 'cat', 'face'],
      },
      {
        c: '😾',
        k: ['pouting', 'cat', 'face'],
      },
    ],
  },
  {
    id: 'body',
    label: 'Gestures & body',
    tone: true,
    items: [
      {
        c: '👋',
        k: ['waving', 'hand'],
      },
      {
        c: '🤚',
        k: ['raised', 'back', 'hand'],
      },
      {
        c: '🖐',
        k: ['raised', 'hand', 'fingers', 'splayed'],
      },
      {
        c: '✋',
        k: ['raised', 'hand'],
      },
      {
        c: '🖖',
        k: ['raised', 'hand', 'part', 'between', 'middle', 'ring'],
      },
      {
        c: '👌',
        k: ['ok', 'hand'],
      },
      {
        c: '🤌',
        k: ['pinched', 'fingers'],
      },
      {
        c: '🤏',
        k: ['pinching', 'hand'],
      },
      {
        c: '✌️',
        k: ['victory', 'hand'],
      },
      {
        c: '🤞',
        k: ['hand', 'index', 'middle', 'fingers', 'crossed'],
      },
      {
        c: '🤟',
        k: ['i', 'love', 'you', 'hand'],
      },
      {
        c: '🤘',
        k: ['horns'],
      },
      {
        c: '🤙',
        k: ['call', 'me', 'hand'],
      },
      {
        c: '👈',
        k: ['white', 'left', 'pointing', 'backhand', 'index'],
      },
      {
        c: '👉',
        k: ['white', 'right', 'pointing', 'backhand', 'index'],
      },
      {
        c: '👆',
        k: ['white', 'up', 'pointing', 'backhand', 'index'],
      },
      {
        c: '🖕',
        k: ['reversed', 'hand', 'middle', 'finger', 'extended'],
      },
      {
        c: '👇',
        k: ['white', 'down', 'pointing', 'backhand', 'index'],
      },
      {
        c: '☝️',
        k: ['white', 'up', 'pointing', 'index'],
      },
      {
        c: '👍',
        k: ['thumbs', 'up'],
      },
      {
        c: '👎',
        k: ['thumbs', 'down'],
      },
      {
        c: '✊',
        k: ['raised', 'fist'],
      },
      {
        c: '👊',
        k: ['fisted', 'hand'],
      },
      {
        c: '🤛',
        k: ['left', 'facing', 'fist'],
      },
      {
        c: '🤜',
        k: ['right', 'facing', 'fist'],
      },
      {
        c: '👏',
        k: ['clapping', 'hands'],
      },
      {
        c: '🙌',
        k: ['person', 'raising', 'both', 'hands', 'celebration'],
      },
      {
        c: '👐',
        k: ['open', 'hands'],
      },
      {
        c: '🤲',
        k: ['palms', 'up', 'together'],
      },
      {
        c: '🤝',
        k: ['handshake'],
      },
      {
        c: '🙏',
        k: ['person', 'folded', 'hands'],
      },
      {
        c: '💅',
        k: ['nail', 'polish'],
      },
      {
        c: '🤳',
        k: ['selfie'],
      },
      {
        c: '💪',
        k: ['flexed', 'biceps'],
      },
      {
        c: '🦾',
        k: ['mechanical', 'arm'],
      },
      {
        c: '🦵',
        k: ['leg'],
      },
      {
        c: '🦶',
        k: ['foot'],
      },
      {
        c: '👂',
        k: ['ear'],
      },
      {
        c: '🦻',
        k: ['ear', 'hearing', 'aid'],
      },
      {
        c: '👃',
        k: ['nose'],
      },
      {
        c: '🧠',
        k: ['brain'],
      },
      {
        c: '🫀',
        k: ['anatomical', 'heart'],
      },
      {
        c: '🫁',
        k: ['lungs'],
      },
      {
        c: '🦷',
        k: ['tooth'],
      },
      {
        c: '🦴',
        k: ['bone'],
      },
      {
        c: '👀',
        k: ['eyes'],
      },
      {
        c: '👁',
        k: ['eye'],
      },
      {
        c: '👅',
        k: ['tongue'],
      },
      {
        c: '👄',
        k: ['mouth'],
      },
      {
        c: '💋',
        k: ['kiss', 'mark'],
      },
      {
        c: '🧑',
        k: ['adult'],
      },
      {
        c: '👶',
        k: ['baby'],
      },
      {
        c: '👦',
        k: ['boy'],
      },
      {
        c: '👧',
        k: ['girl'],
      },
      {
        c: '👩',
        k: ['woman'],
      },
      {
        c: '👨',
        k: ['man'],
      },
      {
        c: '🧓',
        k: ['older', 'adult'],
      },
      {
        c: '🙋',
        k: ['happy', 'person', 'raising', 'one', 'hand'],
      },
      {
        c: '🙅',
        k: ['face', 'good', 'gesture'],
      },
      {
        c: '🙆',
        k: ['face', 'ok', 'gesture'],
      },
      {
        c: '🤷',
        k: ['shrug'],
      },
      {
        c: '🤦',
        k: ['face', 'palm'],
      },
      {
        c: '💁',
        k: ['information', 'desk', 'person'],
      },
      {
        c: '🙇',
        k: ['person', 'bowing', 'deeply'],
      },
      {
        c: '🚶',
        k: ['pedestrian'],
      },
      {
        c: '🏃',
        k: ['runner'],
      },
      {
        c: '💃',
        k: ['dancer'],
      },
      {
        c: '🕺',
        k: ['man', 'dancing'],
      },
      {
        c: '🧘',
        k: ['person', 'lotus', 'position'],
      },
      {
        c: '🤸',
        k: ['person', 'doing', 'cartwheel'],
      },
      {
        c: '🛌',
        k: ['sleeping', 'accommodation'],
      },
    ],
  },
  {
    id: 'nature',
    label: 'Animals & nature',
    tone: false,
    items: [
      {
        c: '🐶',
        k: ['dog', 'face'],
      },
      {
        c: '🐱',
        k: ['cat', 'face'],
      },
      {
        c: '🐭',
        k: ['mouse', 'face'],
      },
      {
        c: '🐹',
        k: ['hamster', 'face'],
      },
      {
        c: '🐰',
        k: ['rabbit', 'face'],
      },
      {
        c: '🦊',
        k: ['fox', 'face'],
      },
      {
        c: '🐻',
        k: ['bear', 'face'],
      },
      {
        c: '🐼',
        k: ['panda', 'face'],
      },
      {
        c: '🐨',
        k: ['koala'],
      },
      {
        c: '🐯',
        k: ['tiger', 'face'],
      },
      {
        c: '🦁',
        k: ['lion', 'face'],
      },
      {
        c: '🐮',
        k: ['cow', 'face'],
      },
      {
        c: '🐷',
        k: ['pig', 'face'],
      },
      {
        c: '🐸',
        k: ['frog', 'face'],
      },
      {
        c: '🐵',
        k: ['monkey', 'face'],
      },
      {
        c: '🙈',
        k: ['see', 'evil', 'monkey'],
      },
      {
        c: '🙉',
        k: ['hear', 'evil', 'monkey'],
      },
      {
        c: '🙊',
        k: ['speak', 'evil', 'monkey'],
      },
      {
        c: '🐔',
        k: ['chicken'],
      },
      {
        c: '🐧',
        k: ['penguin'],
      },
      {
        c: '🐦',
        k: ['bird'],
      },
      {
        c: '🐤',
        k: ['baby', 'chick'],
      },
      {
        c: '🦆',
        k: ['duck'],
      },
      {
        c: '🦅',
        k: ['eagle'],
      },
      {
        c: '🦉',
        k: ['owl'],
      },
      {
        c: '🦇',
        k: ['bat'],
      },
      {
        c: '🐺',
        k: ['wolf', 'face'],
      },
      {
        c: '🐗',
        k: ['boar'],
      },
      {
        c: '🐴',
        k: ['horse', 'face'],
      },
      {
        c: '🦄',
        k: ['unicorn', 'face'],
      },
      {
        c: '🐝',
        k: ['honeybee'],
      },
      {
        c: '🪱',
        k: ['worm'],
      },
      {
        c: '🐛',
        k: ['bug'],
      },
      {
        c: '🦋',
        k: ['butterfly'],
      },
      {
        c: '🐌',
        k: ['snail'],
      },
      {
        c: '🐞',
        k: ['lady', 'beetle'],
      },
      {
        c: '🐜',
        k: ['ant'],
      },
      {
        c: '🪰',
        k: ['fly'],
      },
      {
        c: '🪲',
        k: ['beetle'],
      },
      {
        c: '🕷',
        k: ['spider'],
      },
      {
        c: '🦂',
        k: ['scorpion'],
      },
      {
        c: '🐢',
        k: ['turtle'],
      },
      {
        c: '🐍',
        k: ['snake'],
      },
      {
        c: '🦎',
        k: ['lizard'],
      },
      {
        c: '🦖',
        k: ['t', 'rex'],
      },
      {
        c: '🐙',
        k: ['octopus'],
      },
      {
        c: '🦑',
        k: ['squid'],
      },
      {
        c: '🦐',
        k: ['shrimp'],
      },
      {
        c: '🦞',
        k: ['lobster'],
      },
      {
        c: '🦀',
        k: ['crab'],
      },
      {
        c: '🐡',
        k: ['blowfish'],
      },
      {
        c: '🐠',
        k: ['tropical', 'fish'],
      },
      {
        c: '🐟',
        k: ['fish'],
      },
      {
        c: '🐬',
        k: ['dolphin'],
      },
      {
        c: '🐳',
        k: ['spouting', 'whale'],
      },
      {
        c: '🐋',
        k: ['whale'],
      },
      {
        c: '🦈',
        k: ['shark'],
      },
      {
        c: '🐊',
        k: ['crocodile'],
      },
      {
        c: '🐅',
        k: ['tiger'],
      },
      {
        c: '🦓',
        k: ['zebra', 'face'],
      },
      {
        c: '🦍',
        k: ['gorilla'],
      },
      {
        c: '🦧',
        k: ['orangutan'],
      },
      {
        c: '🐘',
        k: ['elephant'],
      },
      {
        c: '🦛',
        k: ['hippopotamus'],
      },
      {
        c: '🐪',
        k: ['dromedary', 'camel'],
      },
      {
        c: '🦒',
        k: ['giraffe', 'face'],
      },
      {
        c: '🦘',
        k: ['kangaroo'],
      },
      {
        c: '🐃',
        k: ['water', 'buffalo'],
      },
      {
        c: '🐎',
        k: ['horse'],
      },
      {
        c: '🐖',
        k: ['pig'],
      },
      {
        c: '🐏',
        k: ['ram'],
      },
      {
        c: '🐑',
        k: ['sheep'],
      },
      {
        c: '🦙',
        k: ['llama'],
      },
      {
        c: '🐐',
        k: ['goat'],
      },
      {
        c: '🦌',
        k: ['deer'],
      },
      {
        c: '🐕',
        k: ['dog'],
      },
      {
        c: '🐩',
        k: ['poodle'],
      },
      {
        c: '🦮',
        k: ['guide', 'dog'],
      },
      {
        c: '🐈',
        k: ['cat'],
      },
      {
        c: '🐓',
        k: ['rooster'],
      },
      {
        c: '🦃',
        k: ['turkey'],
      },
      {
        c: '🦤',
        k: ['dodo'],
      },
      {
        c: '🦚',
        k: ['peacock'],
      },
      {
        c: '🦜',
        k: ['parrot'],
      },
      {
        c: '🦢',
        k: ['swan'],
      },
      {
        c: '🕊',
        k: ['dove', 'peace'],
      },
      {
        c: '🐇',
        k: ['rabbit'],
      },
      {
        c: '🦝',
        k: ['raccoon'],
      },
      {
        c: '🦦',
        k: ['otter'],
      },
      {
        c: '🦥',
        k: ['sloth'],
      },
      {
        c: '🐁',
        k: ['mouse'],
      },
      {
        c: '🐀',
        k: ['rat'],
      },
      {
        c: '🐿',
        k: ['chipmunk'],
      },
      {
        c: '🦔',
        k: ['hedgehog'],
      },
      {
        c: '🌵',
        k: ['cactus'],
      },
      {
        c: '🎄',
        k: ['christmas', 'tree'],
      },
      {
        c: '🌲',
        k: ['evergreen', 'tree'],
      },
      {
        c: '🌳',
        k: ['deciduous', 'tree'],
      },
      {
        c: '🌴',
        k: ['palm', 'tree'],
      },
      {
        c: '🪵',
        k: ['wood'],
      },
      {
        c: '🌱',
        k: ['seedling'],
      },
      {
        c: '🌿',
        k: ['herb'],
      },
      {
        c: '☘️',
        k: ['shamrock'],
      },
      {
        c: '🍀',
        k: ['four', 'leaf', 'clover'],
      },
      {
        c: '🎍',
        k: ['pine', 'decoration'],
      },
      {
        c: '🪴',
        k: ['potted', 'plant'],
      },
      {
        c: '🎋',
        k: ['tanabata', 'tree'],
      },
      {
        c: '🍃',
        k: ['leaf', 'fluttering', 'wind'],
      },
      {
        c: '🍂',
        k: ['fallen', 'leaf'],
      },
      {
        c: '🍁',
        k: ['maple', 'leaf'],
      },
      {
        c: '🍄',
        k: ['mushroom'],
      },
      {
        c: '🐚',
        k: ['spiral', 'shell'],
      },
      {
        c: '🪨',
        k: ['rock'],
      },
      {
        c: '🌾',
        k: ['ear', 'rice'],
      },
      {
        c: '💐',
        k: ['bouquet'],
      },
      {
        c: '🌷',
        k: ['tulip'],
      },
      {
        c: '🌹',
        k: ['rose'],
      },
      {
        c: '🥀',
        k: ['wilted', 'flower'],
      },
      {
        c: '🌺',
        k: ['hibiscus'],
      },
      {
        c: '🌸',
        k: ['cherry', 'blossom'],
      },
      {
        c: '🌼',
        k: ['blossom'],
      },
      {
        c: '🌻',
        k: ['sunflower'],
      },
      {
        c: '🌞',
        k: ['sun', 'face'],
      },
      {
        c: '🌝',
        k: ['full', 'moon', 'face'],
      },
      {
        c: '🌛',
        k: ['first', 'quarter', 'moon', 'face'],
      },
      {
        c: '🌜',
        k: ['last', 'quarter', 'moon', 'face'],
      },
      {
        c: '🌚',
        k: ['new', 'moon', 'face'],
      },
      {
        c: '🌕',
        k: ['full', 'moon'],
      },
      {
        c: '🌖',
        k: ['waning', 'gibbous', 'moon'],
      },
      {
        c: '🌗',
        k: ['last', 'quarter', 'moon'],
      },
      {
        c: '🌘',
        k: ['waning', 'crescent', 'moon'],
      },
      {
        c: '🌑',
        k: ['new', 'moon'],
      },
      {
        c: '🌒',
        k: ['waxing', 'crescent', 'moon'],
      },
      {
        c: '🌓',
        k: ['first', 'quarter', 'moon'],
      },
      {
        c: '🌔',
        k: ['waxing', 'gibbous', 'moon'],
      },
      {
        c: '🌙',
        k: ['crescent', 'moon'],
      },
      {
        c: '🌎',
        k: ['earth', 'globe', 'americas'],
      },
      {
        c: '🌍',
        k: ['earth', 'globe', 'europe', 'africa'],
      },
      {
        c: '🌏',
        k: ['earth', 'globe', 'asia', 'australia'],
      },
      {
        c: '🪐',
        k: ['ringed', 'planet'],
      },
      {
        c: '💫',
        k: ['dizzy'],
      },
      {
        c: '⭐️',
        k: ['white', 'medium', 'star'],
      },
      {
        c: '🌟',
        k: ['glowing', 'star'],
      },
      {
        c: '✨',
        k: ['sparkles'],
      },
      {
        c: '⚡️',
        k: ['high', 'voltage'],
      },
      {
        c: '☄️',
        k: ['comet'],
      },
      {
        c: '💥',
        k: ['collision'],
      },
      {
        c: '🔥',
        k: ['fire'],
      },
      {
        c: '🌪',
        k: ['cloud', 'tornado'],
      },
      {
        c: '🌈',
        k: ['rainbow'],
      },
      {
        c: '☀️',
        k: ['black', 'sun', 'rays'],
      },
      {
        c: '🌤',
        k: ['white', 'sun', 'small', 'cloud'],
      },
      {
        c: '⛅️',
        k: ['sun', 'behind', 'cloud'],
      },
      {
        c: '🌥',
        k: ['white', 'sun', 'behind', 'cloud'],
      },
      {
        c: '☁️',
        k: ['cloud'],
      },
      {
        c: '🌦',
        k: ['white', 'sun', 'behind', 'cloud', 'rain'],
      },
      {
        c: '🌧',
        k: ['cloud', 'rain'],
      },
      {
        c: '⛈',
        k: ['thunder', 'cloud', 'rain'],
      },
      {
        c: '🌩',
        k: ['cloud', 'lightning'],
      },
      {
        c: '🌨',
        k: ['cloud', 'snow'],
      },
      {
        c: '❄️',
        k: ['snowflake'],
      },
      {
        c: '☃️',
        k: ['snowman'],
      },
      {
        c: '⛄️',
        k: ['snowman', 'without', 'snow'],
      },
      {
        c: '🌬',
        k: ['wind', 'blowing', 'face'],
      },
      {
        c: '💨',
        k: ['dash'],
      },
      {
        c: '💧',
        k: ['droplet'],
      },
      {
        c: '💦',
        k: ['splashing', 'sweat'],
      },
      {
        c: '☔️',
        k: ['umbrella', 'rain', 'drops'],
      },
      {
        c: '🌊',
        k: ['water', 'wave'],
      },
    ],
  },
  {
    id: 'food',
    label: 'Food & drink',
    tone: false,
    items: [
      {
        c: '🍏',
        k: ['green', 'apple'],
      },
      {
        c: '🍎',
        k: ['red', 'apple'],
      },
      {
        c: '🍐',
        k: ['pear'],
      },
      {
        c: '🍊',
        k: ['tangerine'],
      },
      {
        c: '🍋',
        k: ['lemon'],
      },
      {
        c: '🍌',
        k: ['banana'],
      },
      {
        c: '🍉',
        k: ['watermelon'],
      },
      {
        c: '🍇',
        k: ['grapes'],
      },
      {
        c: '🍓',
        k: ['strawberry'],
      },
      {
        c: '🫐',
        k: ['blueberries'],
      },
      {
        c: '🍈',
        k: ['melon'],
      },
      {
        c: '🍒',
        k: ['cherries'],
      },
      {
        c: '🍑',
        k: ['peach'],
      },
      {
        c: '🥭',
        k: ['mango'],
      },
      {
        c: '🍍',
        k: ['pineapple'],
      },
      {
        c: '🥥',
        k: ['coconut'],
      },
      {
        c: '🥝',
        k: ['kiwifruit'],
      },
      {
        c: '🍅',
        k: ['tomato'],
      },
      {
        c: '🍆',
        k: ['aubergine'],
      },
      {
        c: '🥑',
        k: ['avocado'],
      },
      {
        c: '🥦',
        k: ['broccoli'],
      },
      {
        c: '🥬',
        k: ['leafy', 'green'],
      },
      {
        c: '🥒',
        k: ['cucumber'],
      },
      {
        c: '🌶',
        k: ['hot', 'pepper'],
      },
      {
        c: '🫑',
        k: ['bell', 'pepper'],
      },
      {
        c: '🌽',
        k: ['ear', 'maize'],
      },
      {
        c: '🥕',
        k: ['carrot'],
      },
      {
        c: '🫒',
        k: ['olive'],
      },
      {
        c: '🧄',
        k: ['garlic'],
      },
      {
        c: '🧅',
        k: ['onion'],
      },
      {
        c: '🥔',
        k: ['potato'],
      },
      {
        c: '🍠',
        k: ['roasted', 'sweet', 'potato'],
      },
      {
        c: '🥐',
        k: ['croissant'],
      },
      {
        c: '🥯',
        k: ['bagel'],
      },
      {
        c: '🍞',
        k: ['bread'],
      },
      {
        c: '🥖',
        k: ['baguette', 'bread'],
      },
      {
        c: '🥨',
        k: ['pretzel'],
      },
      {
        c: '🧀',
        k: ['cheese', 'wedge'],
      },
      {
        c: '🥚',
        k: ['egg'],
      },
      {
        c: '🍳',
        k: ['cooking'],
      },
      {
        c: '🧈',
        k: ['butter'],
      },
      {
        c: '🥞',
        k: ['pancakes'],
      },
      {
        c: '🧇',
        k: ['waffle'],
      },
      {
        c: '🥓',
        k: ['bacon'],
      },
      {
        c: '🥩',
        k: ['cut', 'meat'],
      },
      {
        c: '🍗',
        k: ['poultry', 'leg'],
      },
      {
        c: '🍖',
        k: ['meat', 'bone'],
      },
      {
        c: '🌭',
        k: ['hot', 'dog'],
      },
      {
        c: '🍔',
        k: ['hamburger'],
      },
      {
        c: '🍟',
        k: ['french', 'fries'],
      },
      {
        c: '🍕',
        k: ['slice', 'pizza'],
      },
      {
        c: '🫓',
        k: ['flatbread'],
      },
      {
        c: '🥪',
        k: ['sandwich'],
      },
      {
        c: '🥙',
        k: ['stuffed', 'flatbread'],
      },
      {
        c: '🧆',
        k: ['falafel'],
      },
      {
        c: '🌮',
        k: ['taco'],
      },
      {
        c: '🌯',
        k: ['burrito'],
      },
      {
        c: '🫔',
        k: ['tamale'],
      },
      {
        c: '🥗',
        k: ['green', 'salad'],
      },
      {
        c: '🥘',
        k: ['shallow', 'pan', 'food'],
      },
      {
        c: '🫕',
        k: ['fondue'],
      },
      {
        c: '🍝',
        k: ['spaghetti'],
      },
      {
        c: '🍜',
        k: ['steaming', 'bowl'],
      },
      {
        c: '🍲',
        k: ['pot', 'food'],
      },
      {
        c: '🍛',
        k: ['curry', 'rice'],
      },
      {
        c: '🍣',
        k: ['sushi'],
      },
      {
        c: '🍱',
        k: ['bento', 'box'],
      },
      {
        c: '🥟',
        k: ['dumpling'],
      },
      {
        c: '🦪',
        k: ['oyster'],
      },
      {
        c: '🍤',
        k: ['fried', 'shrimp'],
      },
      {
        c: '🍙',
        k: ['rice', 'ball'],
      },
      {
        c: '🍚',
        k: ['cooked', 'rice'],
      },
      {
        c: '🍘',
        k: ['rice', 'cracker'],
      },
      {
        c: '🍥',
        k: ['fish', 'cake', 'swirl', 'design'],
      },
      {
        c: '🥠',
        k: ['fortune', 'cookie'],
      },
      {
        c: '🥮',
        k: ['moon', 'cake'],
      },
      {
        c: '🍢',
        k: ['oden'],
      },
      {
        c: '🍡',
        k: ['dango'],
      },
      {
        c: '🍧',
        k: ['shaved', 'ice'],
      },
      {
        c: '🍨',
        k: ['ice', 'cream'],
      },
      {
        c: '🍦',
        k: ['soft', 'ice', 'cream'],
      },
      {
        c: '🥧',
        k: ['pie'],
      },
      {
        c: '🧁',
        k: ['cupcake'],
      },
      {
        c: '🍰',
        k: ['shortcake'],
      },
      {
        c: '🎂',
        k: ['birthday', 'cake'],
      },
      {
        c: '🍮',
        k: ['custard'],
      },
      {
        c: '🍭',
        k: ['lollipop'],
      },
      {
        c: '🍬',
        k: ['candy'],
      },
      {
        c: '🍫',
        k: ['chocolate', 'bar'],
      },
      {
        c: '🍿',
        k: ['popcorn'],
      },
      {
        c: '🍩',
        k: ['doughnut'],
      },
      {
        c: '🍪',
        k: ['cookie'],
      },
      {
        c: '🌰',
        k: ['chestnut'],
      },
      {
        c: '🥜',
        k: ['peanuts'],
      },
      {
        c: '🍯',
        k: ['honey', 'pot'],
      },
      {
        c: '🥛',
        k: ['glass', 'milk'],
      },
      {
        c: '🍼',
        k: ['baby', 'bottle'],
      },
      {
        c: '🫖',
        k: ['teapot'],
      },
      {
        c: '☕️',
        k: ['hot', 'beverage'],
      },
      {
        c: '🍵',
        k: ['teacup', 'without', 'handle'],
      },
      {
        c: '🧃',
        k: ['beverage', 'box'],
      },
      {
        c: '🥤',
        k: ['cup', 'straw'],
      },
      {
        c: '🧋',
        k: ['bubble', 'tea'],
      },
      {
        c: '🍶',
        k: ['sake', 'bottle', 'cup'],
      },
      {
        c: '🍺',
        k: ['beer', 'mug'],
      },
      {
        c: '🍻',
        k: ['clinking', 'beer', 'mugs'],
      },
      {
        c: '🥂',
        k: ['clinking', 'glasses'],
      },
      {
        c: '🍷',
        k: ['wine', 'glass'],
      },
      {
        c: '🥃',
        k: ['tumbler', 'glass'],
      },
      {
        c: '🍸',
        k: ['cocktail', 'glass'],
      },
      {
        c: '🍹',
        k: ['tropical', 'drink'],
      },
      {
        c: '🧉',
        k: ['mate', 'drink'],
      },
      {
        c: '🍾',
        k: ['bottle', 'popping', 'cork'],
      },
      {
        c: '🧊',
        k: ['ice', 'cube'],
      },
      {
        c: '🥄',
        k: ['spoon'],
      },
      {
        c: '🍴',
        k: ['fork', 'knife'],
      },
      {
        c: '🍽',
        k: ['fork', 'knife', 'plate'],
      },
      {
        c: '🥣',
        k: ['bowl', 'spoon'],
      },
      {
        c: '🥡',
        k: ['takeout', 'box'],
      },
      {
        c: '🥢',
        k: ['chopsticks'],
      },
    ],
  },
  {
    id: 'activity',
    label: 'Activity',
    tone: false,
    items: [
      {
        c: '⚽️',
        k: ['soccer', 'ball'],
      },
      {
        c: '🏀',
        k: ['basketball', 'hoop'],
      },
      {
        c: '🏈',
        k: ['american', 'football'],
      },
      {
        c: '⚾️',
        k: ['baseball'],
      },
      {
        c: '🥎',
        k: ['softball'],
      },
      {
        c: '🎾',
        k: ['tennis', 'racquet', 'ball'],
      },
      {
        c: '🏐',
        k: ['volleyball'],
      },
      {
        c: '🏉',
        k: ['rugby', 'football'],
      },
      {
        c: '🥏',
        k: ['flying', 'disc'],
      },
      {
        c: '🎱',
        k: ['billiards'],
      },
      {
        c: '🪀',
        k: ['yo'],
      },
      {
        c: '🏓',
        k: ['table', 'tennis', 'paddle', 'ball'],
      },
      {
        c: '🏸',
        k: ['badminton', 'racquet', 'shuttlecock'],
      },
      {
        c: '🏒',
        k: ['ice', 'hockey', 'stick', 'puck'],
      },
      {
        c: '🏑',
        k: ['field', 'hockey', 'stick', 'ball'],
      },
      {
        c: '🥍',
        k: ['lacrosse', 'stick', 'ball'],
      },
      {
        c: '🏏',
        k: ['cricket', 'bat', 'ball'],
      },
      {
        c: '🪃',
        k: ['boomerang'],
      },
      {
        c: '🥅',
        k: ['goal', 'net'],
      },
      {
        c: '⛳️',
        k: ['flag', 'hole'],
      },
      {
        c: '🪁',
        k: ['kite'],
      },
      {
        c: '🏹',
        k: ['bow', 'arrow'],
      },
      {
        c: '🎣',
        k: ['fishing', 'pole', 'fish'],
      },
      {
        c: '🤿',
        k: ['diving', 'mask'],
      },
      {
        c: '🥊',
        k: ['boxing', 'glove'],
      },
      {
        c: '🥋',
        k: ['martial', 'arts', 'uniform'],
      },
      {
        c: '🎽',
        k: ['running', 'shirt', 'sash'],
      },
      {
        c: '🛹',
        k: ['skateboard'],
      },
      {
        c: '🛼',
        k: ['roller', 'skate'],
      },
      {
        c: '🛷',
        k: ['sled'],
      },
      {
        c: '⛸',
        k: ['ice', 'skate'],
      },
      {
        c: '🥌',
        k: ['curling', 'stone'],
      },
      {
        c: '🎿',
        k: ['ski', 'boot'],
      },
      {
        c: '⛷',
        k: ['skier'],
      },
      {
        c: '🏂',
        k: ['snowboarder'],
      },
      {
        c: '🪂',
        k: ['parachute'],
      },
      {
        c: '🏋️',
        k: ['weight', 'lifter'],
      },
      {
        c: '🤼',
        k: ['wrestlers'],
      },
      {
        c: '🤸',
        k: ['person', 'doing', 'cartwheel'],
      },
      {
        c: '⛹️',
        k: ['person', 'ball'],
      },
      {
        c: '🤺',
        k: ['fencer'],
      },
      {
        c: '🤾',
        k: ['handball'],
      },
      {
        c: '🏌️',
        k: ['golfer'],
      },
      {
        c: '🏇',
        k: ['horse', 'racing'],
      },
      {
        c: '🧘',
        k: ['person', 'lotus', 'position'],
      },
      {
        c: '🏄',
        k: ['surfer'],
      },
      {
        c: '🏊',
        k: ['swimmer'],
      },
      {
        c: '🤽',
        k: ['water', 'polo'],
      },
      {
        c: '🚣',
        k: ['rowboat'],
      },
      {
        c: '🧗',
        k: ['person', 'climbing'],
      },
      {
        c: '🚵',
        k: ['mountain', 'bicyclist'],
      },
      {
        c: '🚴',
        k: ['bicyclist'],
      },
      {
        c: '🏆',
        k: ['trophy'],
      },
      {
        c: '🥇',
        k: ['first', 'place', 'medal'],
      },
      {
        c: '🥈',
        k: ['second', 'place', 'medal'],
      },
      {
        c: '🥉',
        k: ['third', 'place', 'medal'],
      },
      {
        c: '🏅',
        k: ['sports', 'medal'],
      },
      {
        c: '🎖',
        k: ['military', 'medal'],
      },
      {
        c: '🏵',
        k: ['rosette'],
      },
      {
        c: '🎗',
        k: ['reminder', 'ribbon'],
      },
      {
        c: '🎫',
        k: ['ticket'],
      },
      {
        c: '🎟',
        k: ['admission', 'tickets'],
      },
      {
        c: '🎪',
        k: ['circus', 'tent'],
      },
      {
        c: '🤹',
        k: ['juggling'],
      },
      {
        c: '🎭',
        k: ['performing', 'arts'],
      },
      {
        c: '🩰',
        k: ['ballet', 'shoes'],
      },
      {
        c: '🎨',
        k: ['artist', 'palette'],
      },
      {
        c: '🎬',
        k: ['clapper', 'board'],
      },
      {
        c: '🎤',
        k: ['microphone'],
      },
      {
        c: '🎧',
        k: ['headphone'],
      },
      {
        c: '🎼',
        k: ['musical', 'score'],
      },
      {
        c: '🎹',
        k: ['musical', 'keyboard'],
      },
      {
        c: '🥁',
        k: ['drum', 'drumsticks'],
      },
      {
        c: '🪘',
        k: ['long', 'drum'],
      },
      {
        c: '🎷',
        k: ['saxophone'],
      },
      {
        c: '🎺',
        k: ['trumpet'],
      },
      {
        c: '🪗',
        k: ['accordion'],
      },
      {
        c: '🎸',
        k: ['guitar'],
      },
      {
        c: '🪕',
        k: ['banjo'],
      },
      {
        c: '🎻',
        k: ['violin'],
      },
      {
        c: '🎲',
        k: ['game', 'die'],
      },
      {
        c: '♟',
        k: ['black', 'chess', 'pawn'],
      },
      {
        c: '🎯',
        k: ['direct', 'hit'],
      },
      {
        c: '🎳',
        k: ['bowling'],
      },
      {
        c: '🎮',
        k: ['video', 'game'],
      },
      {
        c: '🎰',
        k: ['slot', 'machine'],
      },
      {
        c: '🧩',
        k: ['jigsaw', 'puzzle', 'piece'],
      },
    ],
  },
  {
    id: 'travel',
    label: 'Travel & places',
    tone: false,
    items: [
      {
        c: '🚗',
        k: ['automobile'],
      },
      {
        c: '🚕',
        k: ['taxi'],
      },
      {
        c: '🚙',
        k: ['recreational', 'vehicle'],
      },
      {
        c: '🚌',
        k: ['bus'],
      },
      {
        c: '🚎',
        k: ['trolleybus'],
      },
      {
        c: '🏎',
        k: ['racing', 'car'],
      },
      {
        c: '🚓',
        k: ['police', 'car'],
      },
      {
        c: '🚑',
        k: ['ambulance'],
      },
      {
        c: '🚒',
        k: ['fire', 'engine'],
      },
      {
        c: '🚐',
        k: ['minibus'],
      },
      {
        c: '🛻',
        k: ['pickup', 'truck'],
      },
      {
        c: '🚚',
        k: ['delivery', 'truck'],
      },
      {
        c: '🚛',
        k: ['articulated', 'lorry'],
      },
      {
        c: '🚜',
        k: ['tractor'],
      },
      {
        c: '🦯',
        k: ['probing', 'cane'],
      },
      {
        c: '🦽',
        k: ['manual', 'wheelchair'],
      },
      {
        c: '🦼',
        k: ['motorized', 'wheelchair'],
      },
      {
        c: '🛴',
        k: ['scooter'],
      },
      {
        c: '🚲',
        k: ['bicycle'],
      },
      {
        c: '🛵',
        k: ['motor', 'scooter'],
      },
      {
        c: '🏍',
        k: ['racing', 'motorcycle'],
      },
      {
        c: '🛺',
        k: ['auto', 'rickshaw'],
      },
      {
        c: '🚨',
        k: ['police', 'cars', 'revolving', 'light'],
      },
      {
        c: '🚔',
        k: ['oncoming', 'police', 'car'],
      },
      {
        c: '🚍',
        k: ['oncoming', 'bus'],
      },
      {
        c: '🚘',
        k: ['oncoming', 'automobile'],
      },
      {
        c: '🚖',
        k: ['oncoming', 'taxi'],
      },
      {
        c: '🚡',
        k: ['aerial', 'tramway'],
      },
      {
        c: '🚠',
        k: ['mountain', 'cableway'],
      },
      {
        c: '🚟',
        k: ['suspension', 'railway'],
      },
      {
        c: '🚃',
        k: ['railway', 'car'],
      },
      {
        c: '🚋',
        k: ['tram', 'car'],
      },
      {
        c: '🚞',
        k: ['mountain', 'railway'],
      },
      {
        c: '🚝',
        k: ['monorail'],
      },
      {
        c: '🚄',
        k: ['high', 'speed', 'train'],
      },
      {
        c: '🚅',
        k: ['high', 'speed', 'train', 'bullet', 'nose'],
      },
      {
        c: '🚈',
        k: ['light', 'rail'],
      },
      {
        c: '🚂',
        k: ['steam', 'locomotive'],
      },
      {
        c: '🚆',
        k: ['train'],
      },
      {
        c: '🚇',
        k: ['metro'],
      },
      {
        c: '🚊',
        k: ['tram'],
      },
      {
        c: '🚉',
        k: ['station'],
      },
      {
        c: '✈️',
        k: ['airplane'],
      },
      {
        c: '🛫',
        k: ['airplane', 'departure'],
      },
      {
        c: '🛬',
        k: ['airplane', 'arriving'],
      },
      {
        c: '🛩',
        k: ['small', 'airplane'],
      },
      {
        c: '💺',
        k: ['seat'],
      },
      {
        c: '🛰',
        k: ['satellite'],
      },
      {
        c: '🚀',
        k: ['rocket'],
      },
      {
        c: '🛸',
        k: ['flying', 'saucer'],
      },
      {
        c: '🚁',
        k: ['helicopter'],
      },
      {
        c: '🛶',
        k: ['canoe'],
      },
      {
        c: '⛵️',
        k: ['sailboat'],
      },
      {
        c: '🚤',
        k: ['speedboat'],
      },
      {
        c: '🛥',
        k: ['motor', 'boat'],
      },
      {
        c: '🛳',
        k: ['passenger', 'ship'],
      },
      {
        c: '⛴',
        k: ['ferry'],
      },
      {
        c: '🚢',
        k: ['ship'],
      },
      {
        c: '⚓️',
        k: ['anchor'],
      },
      {
        c: '🪝',
        k: ['hook'],
      },
      {
        c: '⛽️',
        k: ['fuel', 'pump'],
      },
      {
        c: '🚧',
        k: ['construction'],
      },
      {
        c: '🚦',
        k: ['vertical', 'traffic', 'light'],
      },
      {
        c: '🚥',
        k: ['horizontal', 'traffic', 'light'],
      },
      {
        c: '🗺',
        k: ['world', 'map'],
      },
      {
        c: '🗿',
        k: ['moyai'],
      },
      {
        c: '🗽',
        k: ['statue', 'liberty'],
      },
      {
        c: '🗼',
        k: ['tokyo', 'tower'],
      },
      {
        c: '🏰',
        k: ['european', 'castle'],
      },
      {
        c: '🏯',
        k: ['japanese', 'castle'],
      },
      {
        c: '🏟',
        k: ['stadium'],
      },
      {
        c: '🎡',
        k: ['ferris', 'wheel'],
      },
      {
        c: '🎢',
        k: ['roller', 'coaster'],
      },
      {
        c: '🎠',
        k: ['carousel', 'horse'],
      },
      {
        c: '⛲️',
        k: ['fountain'],
      },
      {
        c: '⛱',
        k: ['umbrella', 'ground'],
      },
      {
        c: '🏖',
        k: ['beach', 'umbrella'],
      },
      {
        c: '🏝',
        k: ['desert', 'island'],
      },
      {
        c: '🏜',
        k: ['desert'],
      },
      {
        c: '🌋',
        k: ['volcano'],
      },
      {
        c: '⛰',
        k: ['mountain'],
      },
      {
        c: '🏔',
        k: ['snow', 'capped', 'mountain'],
      },
      {
        c: '🗻',
        k: ['mount', 'fuji'],
      },
      {
        c: '🏕',
        k: ['camping'],
      },
      {
        c: '⛺️',
        k: ['tent'],
      },
      {
        c: '🛖',
        k: ['hut'],
      },
      {
        c: '🏠',
        k: ['house', 'building'],
      },
      {
        c: '🏡',
        k: ['house', 'garden'],
      },
      {
        c: '🏘',
        k: ['house', 'buildings'],
      },
      {
        c: '🏚',
        k: ['derelict', 'house', 'building'],
      },
      {
        c: '🏗',
        k: ['building', 'construction'],
      },
      {
        c: '🏭',
        k: ['factory'],
      },
      {
        c: '🏢',
        k: ['office', 'building'],
      },
      {
        c: '🏬',
        k: ['department', 'store'],
      },
      {
        c: '🏣',
        k: ['japanese', 'post', 'office'],
      },
      {
        c: '🏤',
        k: ['european', 'post', 'office'],
      },
      {
        c: '🏥',
        k: ['hospital'],
      },
      {
        c: '🏦',
        k: ['bank'],
      },
      {
        c: '🏨',
        k: ['hotel'],
      },
      {
        c: '🏪',
        k: ['convenience', 'store'],
      },
      {
        c: '🏫',
        k: ['school'],
      },
      {
        c: '🏩',
        k: ['love', 'hotel'],
      },
      {
        c: '💒',
        k: ['wedding'],
      },
      {
        c: '🏛',
        k: ['classical', 'building'],
      },
      {
        c: '⛪️',
        k: ['church'],
      },
      {
        c: '🕌',
        k: ['mosque'],
      },
      {
        c: '🕍',
        k: ['synagogue'],
      },
      {
        c: '🛕',
        k: ['hindu', 'temple'],
      },
      {
        c: '🕋',
        k: ['kaaba'],
      },
      {
        c: '⛩',
        k: ['shinto', 'shrine'],
      },
      {
        c: '🌁',
        k: ['foggy'],
      },
      {
        c: '🌃',
        k: ['night', 'stars'],
      },
      {
        c: '🏙',
        k: ['cityscape'],
      },
      {
        c: '🌄',
        k: ['sunrise', 'over', 'mountains'],
      },
      {
        c: '🌅',
        k: ['sunrise'],
      },
      {
        c: '🌆',
        k: ['cityscape', 'at', 'dusk'],
      },
      {
        c: '🌇',
        k: ['sunset', 'over', 'buildings'],
      },
      {
        c: '🌉',
        k: ['bridge', 'at', 'night'],
      },
      {
        c: '🎑',
        k: ['moon', 'viewing', 'ceremony'],
      },
      {
        c: '🌌',
        k: ['milky', 'way'],
      },
    ],
  },
  {
    id: 'objects',
    label: 'Objects',
    tone: false,
    items: [
      {
        c: '⌚️',
        k: ['watch'],
      },
      {
        c: '📱',
        k: ['mobile', 'phone'],
      },
      {
        c: '💻',
        k: ['personal', 'computer'],
      },
      {
        c: '⌨️',
        k: ['keyboard'],
      },
      {
        c: '🖥',
        k: ['desktop', 'computer'],
      },
      {
        c: '🖨',
        k: ['printer'],
      },
      {
        c: '🖱',
        k: ['three', 'button', 'mouse'],
      },
      {
        c: '🖲',
        k: ['trackball'],
      },
      {
        c: '🕹',
        k: ['joystick'],
      },
      {
        c: '🗜',
        k: ['compression'],
      },
      {
        c: '💽',
        k: ['minidisc'],
      },
      {
        c: '💾',
        k: ['floppy', 'disk'],
      },
      {
        c: '💿',
        k: ['optical', 'disc'],
      },
      {
        c: '📀',
        k: ['dvd'],
      },
      {
        c: '📼',
        k: ['videocassette'],
      },
      {
        c: '📷',
        k: ['camera'],
      },
      {
        c: '📸',
        k: ['camera', 'flash'],
      },
      {
        c: '📹',
        k: ['video', 'camera'],
      },
      {
        c: '🎥',
        k: ['movie', 'camera'],
      },
      {
        c: '📽',
        k: ['film', 'projector'],
      },
      {
        c: '📞',
        k: ['telephone', 'receiver'],
      },
      {
        c: '☎️',
        k: ['black', 'telephone'],
      },
      {
        c: '📟',
        k: ['pager'],
      },
      {
        c: '📠',
        k: ['fax', 'machine'],
      },
      {
        c: '📺',
        k: ['television'],
      },
      {
        c: '📻',
        k: ['radio'],
      },
      {
        c: '🎙',
        k: ['studio', 'microphone'],
      },
      {
        c: '⏱',
        k: ['stopwatch'],
      },
      {
        c: '⏲',
        k: ['timer', 'clock'],
      },
      {
        c: '⏰',
        k: ['alarm', 'clock'],
      },
      {
        c: '🕰',
        k: ['mantelpiece', 'clock'],
      },
      {
        c: '⌛️',
        k: ['hourglass'],
      },
      {
        c: '⏳',
        k: ['hourglass', 'flowing', 'sand'],
      },
      {
        c: '📡',
        k: ['satellite', 'antenna'],
      },
      {
        c: '🔋',
        k: ['battery'],
      },
      {
        c: '🔌',
        k: ['electric', 'plug'],
      },
      {
        c: '💡',
        k: ['electric', 'light', 'bulb'],
      },
      {
        c: '🔦',
        k: ['electric', 'torch'],
      },
      {
        c: '🕯',
        k: ['candle'],
      },
      {
        c: '🧯',
        k: ['fire', 'extinguisher'],
      },
      {
        c: '🛢',
        k: ['oil', 'drum'],
      },
      {
        c: '💸',
        k: ['money', 'wings'],
      },
      {
        c: '💵',
        k: ['banknote', 'dollar'],
      },
      {
        c: '💴',
        k: ['banknote', 'yen'],
      },
      {
        c: '💶',
        k: ['banknote', 'euro'],
      },
      {
        c: '💷',
        k: ['banknote', 'pound'],
      },
      {
        c: '🪙',
        k: ['coin'],
      },
      {
        c: '💰',
        k: ['money', 'bag'],
      },
      {
        c: '💳',
        k: ['credit', 'card'],
      },
      {
        c: '💎',
        k: ['gem', 'stone'],
      },
      {
        c: '⚖️',
        k: ['scales'],
      },
      {
        c: '🪜',
        k: ['ladder'],
      },
      {
        c: '🧰',
        k: ['toolbox'],
      },
      {
        c: '🪛',
        k: ['screwdriver'],
      },
      {
        c: '🔧',
        k: ['wrench'],
      },
      {
        c: '🔨',
        k: ['hammer'],
      },
      {
        c: '⚒',
        k: ['hammer', 'pick'],
      },
      {
        c: '🛠',
        k: ['hammer', 'wrench'],
      },
      {
        c: '⛏',
        k: ['pick'],
      },
      {
        c: '🪚',
        k: ['carpentry', 'saw'],
      },
      {
        c: '🔩',
        k: ['nut', 'bolt'],
      },
      {
        c: '⚙️',
        k: ['gear'],
      },
      {
        c: '🧱',
        k: ['brick'],
      },
      {
        c: '⛓',
        k: ['chains'],
      },
      {
        c: '🧲',
        k: ['magnet'],
      },
      {
        c: '🔫',
        k: ['pistol'],
      },
      {
        c: '💣',
        k: ['bomb'],
      },
      {
        c: '🧨',
        k: ['firecracker'],
      },
      {
        c: '🪓',
        k: ['axe'],
      },
      {
        c: '🔪',
        k: ['hocho'],
      },
      {
        c: '🗡',
        k: ['dagger', 'knife'],
      },
      {
        c: '⚔️',
        k: ['crossed', 'swords'],
      },
      {
        c: '🛡',
        k: ['shield'],
      },
      {
        c: '🚬',
        k: ['smoking'],
      },
      {
        c: '⚰️',
        k: ['coffin'],
      },
      {
        c: '🪦',
        k: ['headstone'],
      },
      {
        c: '⚱️',
        k: ['funeral', 'urn'],
      },
      {
        c: '🏺',
        k: ['amphora'],
      },
      {
        c: '🔮',
        k: ['crystal', 'ball'],
      },
      {
        c: '📿',
        k: ['prayer', 'beads'],
      },
      {
        c: '🧿',
        k: ['nazar', 'amulet'],
      },
      {
        c: '💈',
        k: ['barber', 'pole'],
      },
      {
        c: '⚗️',
        k: ['alembic'],
      },
      {
        c: '🔭',
        k: ['telescope'],
      },
      {
        c: '🔬',
        k: ['microscope'],
      },
      {
        c: '🕳',
        k: ['hole'],
      },
      {
        c: '🩹',
        k: ['adhesive', 'bandage'],
      },
      {
        c: '🩺',
        k: ['stethoscope'],
      },
      {
        c: '💊',
        k: ['pill'],
      },
      {
        c: '💉',
        k: ['syringe'],
      },
      {
        c: '🩸',
        k: ['drop', 'blood'],
      },
      {
        c: '🧬',
        k: ['dna', 'double', 'helix'],
      },
      {
        c: '🦠',
        k: ['microbe'],
      },
      {
        c: '🧫',
        k: ['petri', 'dish'],
      },
      {
        c: '🧪',
        k: ['test', 'tube'],
      },
      {
        c: '🌡',
        k: ['thermometer'],
      },
      {
        c: '🧹',
        k: ['broom'],
      },
      {
        c: '🪠',
        k: ['plunger'],
      },
      {
        c: '🧺',
        k: ['basket'],
      },
      {
        c: '🧻',
        k: ['roll', 'paper'],
      },
      {
        c: '🚽',
        k: ['toilet'],
      },
      {
        c: '🚰',
        k: ['potable', 'water'],
      },
      {
        c: '🚿',
        k: ['shower'],
      },
      {
        c: '🛁',
        k: ['bathtub'],
      },
      {
        c: '🛀',
        k: ['bath'],
      },
      {
        c: '🧼',
        k: ['bar', 'soap'],
      },
      {
        c: '🪥',
        k: ['toothbrush'],
      },
      {
        c: '🪒',
        k: ['razor'],
      },
      {
        c: '🧽',
        k: ['sponge'],
      },
      {
        c: '🪣',
        k: ['bucket'],
      },
      {
        c: '🧴',
        k: ['lotion', 'bottle'],
      },
      {
        c: '🛎',
        k: ['bellhop', 'bell'],
      },
      {
        c: '🔑',
        k: ['key'],
      },
      {
        c: '🗝',
        k: ['old', 'key'],
      },
      {
        c: '🚪',
        k: ['door'],
      },
      {
        c: '🪑',
        k: ['chair'],
      },
      {
        c: '🛋',
        k: ['couch', 'lamp'],
      },
      {
        c: '🛏',
        k: ['bed'],
      },
      {
        c: '🧸',
        k: ['teddy', 'bear'],
      },
      {
        c: '🪆',
        k: ['nesting', 'dolls'],
      },
      {
        c: '🖼',
        k: ['frame', 'picture'],
      },
      {
        c: '🪞',
        k: ['mirror'],
      },
      {
        c: '🪟',
        k: ['window'],
      },
      {
        c: '🛍',
        k: ['shopping', 'bags'],
      },
      {
        c: '🛒',
        k: ['shopping', 'trolley'],
      },
      {
        c: '🎁',
        k: ['wrapped', 'present'],
      },
      {
        c: '🎈',
        k: ['balloon'],
      },
      {
        c: '🎏',
        k: ['carp', 'streamer'],
      },
      {
        c: '🎀',
        k: ['ribbon'],
      },
      {
        c: '🪄',
        k: ['magic', 'wand'],
      },
      {
        c: '🪅',
        k: ['pinata'],
      },
      {
        c: '🎊',
        k: ['confetti', 'ball'],
      },
      {
        c: '🎉',
        k: ['party', 'popper'],
      },
      {
        c: '🎎',
        k: ['japanese', 'dolls'],
      },
      {
        c: '🏮',
        k: ['izakaya', 'lantern'],
      },
      {
        c: '🎐',
        k: ['wind', 'chime'],
      },
      {
        c: '🧧',
        k: ['red', 'gift', 'envelope'],
      },
      {
        c: '✉️',
        k: ['envelope'],
      },
      {
        c: '📩',
        k: ['envelope', 'downwards', 'arrow', 'above'],
      },
      {
        c: '📨',
        k: ['incoming', 'envelope'],
      },
      {
        c: '📧',
        k: ['e', 'mail'],
      },
      {
        c: '💌',
        k: ['love', 'letter'],
      },
      {
        c: '📥',
        k: ['inbox', 'tray'],
      },
      {
        c: '📤',
        k: ['outbox', 'tray'],
      },
      {
        c: '📦',
        k: ['package'],
      },
      {
        c: '🏷',
        k: ['label'],
      },
      {
        c: '🪧',
        k: ['placard'],
      },
      {
        c: '📪',
        k: ['closed', 'mailbox', 'lowered', 'flag'],
      },
      {
        c: '📫',
        k: ['closed', 'mailbox', 'raised', 'flag'],
      },
      {
        c: '📬',
        k: ['open', 'mailbox', 'raised', 'flag'],
      },
      {
        c: '📭',
        k: ['open', 'mailbox', 'lowered', 'flag'],
      },
      {
        c: '📮',
        k: ['postbox'],
      },
      {
        c: '📯',
        k: ['postal', 'horn'],
      },
      {
        c: '📜',
        k: ['scroll'],
      },
      {
        c: '📃',
        k: ['page', 'curl'],
      },
      {
        c: '📄',
        k: ['page', 'facing', 'up'],
      },
      {
        c: '📑',
        k: ['bookmark', 'tabs'],
      },
      {
        c: '🧾',
        k: ['receipt'],
      },
      {
        c: '📊',
        k: ['bar', 'chart'],
      },
      {
        c: '📈',
        k: ['chart', 'upwards', 'trend'],
      },
      {
        c: '📉',
        k: ['chart', 'downwards', 'trend'],
      },
      {
        c: '🗒',
        k: ['spiral', 'note', 'pad'],
      },
      {
        c: '🗓',
        k: ['spiral', 'calendar', 'pad'],
      },
      {
        c: '📆',
        k: ['tear', 'off', 'calendar'],
      },
      {
        c: '📅',
        k: ['calendar'],
      },
      {
        c: '🗑',
        k: ['wastebasket'],
      },
      {
        c: '📇',
        k: ['card', 'index'],
      },
      {
        c: '🗃',
        k: ['card', 'file', 'box'],
      },
      {
        c: '🗳',
        k: ['ballot', 'box'],
      },
      {
        c: '🗄',
        k: ['file', 'cabinet'],
      },
      {
        c: '📋',
        k: ['clipboard'],
      },
      {
        c: '📁',
        k: ['file', 'folder'],
      },
      {
        c: '📂',
        k: ['open', 'file', 'folder'],
      },
      {
        c: '🗂',
        k: ['card', 'index', 'dividers'],
      },
      {
        c: '🗞',
        k: ['rolled', 'up', 'newspaper'],
      },
      {
        c: '📰',
        k: ['newspaper'],
      },
      {
        c: '📓',
        k: ['notebook'],
      },
      {
        c: '📔',
        k: ['notebook', 'decorative', 'cover'],
      },
      {
        c: '📒',
        k: ['ledger'],
      },
      {
        c: '📕',
        k: ['closed', 'book'],
      },
      {
        c: '📗',
        k: ['green', 'book'],
      },
      {
        c: '📘',
        k: ['blue', 'book'],
      },
      {
        c: '📙',
        k: ['orange', 'book'],
      },
      {
        c: '📚',
        k: ['books'],
      },
      {
        c: '📖',
        k: ['open', 'book'],
      },
      {
        c: '🔖',
        k: ['bookmark'],
      },
      {
        c: '🧷',
        k: ['safety', 'pin'],
      },
      {
        c: '🔗',
        k: ['link'],
      },
      {
        c: '📎',
        k: ['paperclip'],
      },
      {
        c: '🖇',
        k: ['linked', 'paperclips'],
      },
      {
        c: '📐',
        k: ['triangular', 'ruler'],
      },
      {
        c: '📏',
        k: ['straight', 'ruler'],
      },
      {
        c: '🧮',
        k: ['abacus'],
      },
      {
        c: '📌',
        k: ['pushpin'],
      },
      {
        c: '📍',
        k: ['round', 'pushpin'],
      },
      {
        c: '✂️',
        k: ['black', 'scissors'],
      },
      {
        c: '🖊',
        k: ['lower', 'left', 'ballpoint', 'pen'],
      },
      {
        c: '🖋',
        k: ['lower', 'left', 'fountain', 'pen'],
      },
      {
        c: '✒️',
        k: ['black', 'nib'],
      },
      {
        c: '🖌',
        k: ['lower', 'left', 'paintbrush'],
      },
      {
        c: '🖍',
        k: ['lower', 'left', 'crayon'],
      },
      {
        c: '📝',
        k: ['memo'],
      },
      {
        c: '✏️',
        k: ['pencil'],
      },
      {
        c: '🔍',
        k: ['left', 'pointing', 'magnifying', 'glass'],
      },
      {
        c: '🔎',
        k: ['right', 'pointing', 'magnifying', 'glass'],
      },
      {
        c: '🔏',
        k: ['lock', 'ink', 'pen'],
      },
      {
        c: '🔐',
        k: ['closed', 'lock', 'key'],
      },
      {
        c: '🔒',
        k: ['lock'],
      },
      {
        c: '🔓',
        k: ['open', 'lock'],
      },
    ],
  },
  {
    id: 'symbols',
    label: 'Symbols',
    tone: false,
    items: [
      {
        c: '❤️',
        k: ['heavy', 'black', 'heart'],
      },
      {
        c: '🧡',
        k: ['orange', 'heart'],
      },
      {
        c: '💛',
        k: ['yellow', 'heart'],
      },
      {
        c: '💚',
        k: ['green', 'heart'],
      },
      {
        c: '💙',
        k: ['blue', 'heart'],
      },
      {
        c: '💜',
        k: ['purple', 'heart'],
      },
      {
        c: '🖤',
        k: ['black', 'heart'],
      },
      {
        c: '🤍',
        k: ['white', 'heart'],
      },
      {
        c: '🤎',
        k: ['brown', 'heart'],
      },
      {
        c: '💔',
        k: ['broken', 'heart'],
      },
      {
        c: '❣️',
        k: ['heavy', 'heart', 'exclamation', 'mark', 'ornament'],
      },
      {
        c: '💕',
        k: ['two', 'hearts'],
      },
      {
        c: '💞',
        k: ['revolving', 'hearts'],
      },
      {
        c: '💓',
        k: ['beating', 'heart'],
      },
      {
        c: '💗',
        k: ['growing', 'heart'],
      },
      {
        c: '💖',
        k: ['sparkling', 'heart'],
      },
      {
        c: '💘',
        k: ['heart', 'arrow'],
      },
      {
        c: '💝',
        k: ['heart', 'ribbon'],
      },
      {
        c: '💟',
        k: ['heart', 'decoration'],
      },
      {
        c: '☮️',
        k: ['peace'],
      },
      {
        c: '✝️',
        k: ['latin', 'cross'],
      },
      {
        c: '☪️',
        k: ['star', 'crescent'],
      },
      {
        c: '🕉',
        k: ['om'],
      },
      {
        c: '☸️',
        k: ['wheel', 'dharma'],
      },
      {
        c: '✡️',
        k: ['star', 'david'],
      },
      {
        c: '🔯',
        k: ['six', 'pointed', 'star', 'middle', 'dot'],
      },
      {
        c: '🕎',
        k: ['menorah', 'nine', 'branches'],
      },
      {
        c: '☯️',
        k: ['yin', 'yang'],
      },
      {
        c: '☦️',
        k: ['orthodox', 'cross'],
      },
      {
        c: '🛐',
        k: ['place', 'worship'],
      },
      {
        c: '⛎',
        k: ['ophiuchus'],
      },
      {
        c: '♈️',
        k: ['aries'],
      },
      {
        c: '♉️',
        k: ['taurus'],
      },
      {
        c: '♊️',
        k: ['gemini'],
      },
      {
        c: '♋️',
        k: ['cancer'],
      },
      {
        c: '♌️',
        k: ['leo'],
      },
      {
        c: '♍️',
        k: ['virgo'],
      },
      {
        c: '♎️',
        k: ['libra'],
      },
      {
        c: '♏️',
        k: ['scorpius'],
      },
      {
        c: '♐️',
        k: ['sagittarius'],
      },
      {
        c: '♑️',
        k: ['capricorn'],
      },
      {
        c: '♒️',
        k: ['aquarius'],
      },
      {
        c: '♓️',
        k: ['pisces'],
      },
      {
        c: '🆔',
        k: ['squared', 'id'],
      },
      {
        c: '⚛️',
        k: ['atom'],
      },
      {
        c: '🉑',
        k: ['circled', 'ideograph', 'accept'],
      },
      {
        c: '☢️',
        k: ['radioactive'],
      },
      {
        c: '☣️',
        k: ['biohazard'],
      },
      {
        c: '📴',
        k: ['mobile', 'phone', 'off'],
      },
      {
        c: '📳',
        k: ['vibration', 'mode'],
      },
      {
        c: '🈶',
        k: ['squared', 'cjk', 'unified', 'ideograph', '6709'],
      },
      {
        c: '🈚️',
        k: ['squared', 'cjk', 'unified', 'ideograph', '7121'],
      },
      {
        c: '🈸',
        k: ['squared', 'cjk', 'unified', 'ideograph', '7533'],
      },
      {
        c: '🈺',
        k: ['squared', 'cjk', 'unified', 'ideograph', '55b6'],
      },
      {
        c: '🈷️',
        k: ['squared', 'cjk', 'unified', 'ideograph', '6708'],
      },
      {
        c: '✴️',
        k: ['eight', 'pointed', 'black', 'star'],
      },
      {
        c: '🆚',
        k: ['squared', 'vs'],
      },
      {
        c: '💮',
        k: ['white', 'flower'],
      },
      {
        c: '🉐',
        k: ['circled', 'ideograph', 'advantage'],
      },
      {
        c: '㊙️',
        k: ['circled', 'ideograph', 'secret'],
      },
      {
        c: '㊗️',
        k: ['circled', 'ideograph', 'congratulation'],
      },
      {
        c: '🈴',
        k: ['squared', 'cjk', 'unified', 'ideograph', '5408'],
      },
      {
        c: '🈵',
        k: ['squared', 'cjk', 'unified', 'ideograph', '6e80'],
      },
      {
        c: '🈹',
        k: ['squared', 'cjk', 'unified', 'ideograph', '5272'],
      },
      {
        c: '🈲',
        k: ['squared', 'cjk', 'unified', 'ideograph', '7981'],
      },
      {
        c: '🅰️',
        k: ['negative', 'squared', 'latin', 'capital', 'letter'],
      },
      {
        c: '🅱️',
        k: ['negative', 'squared', 'latin', 'capital', 'letter', 'b'],
      },
      {
        c: '🆎',
        k: ['negative', 'squared', 'ab'],
      },
      {
        c: '🆑',
        k: ['squared', 'cl'],
      },
      {
        c: '🅾️',
        k: ['negative', 'squared', 'latin', 'capital', 'letter', 'o'],
      },
      {
        c: '🆘',
        k: ['squared', 'sos'],
      },
      {
        c: '❌',
        k: ['cross', 'mark'],
      },
      {
        c: '⭕️',
        k: ['heavy', 'large', 'circle'],
      },
      {
        c: '🛑',
        k: ['octagonal'],
      },
      {
        c: '⛔️',
        k: ['entry'],
      },
      {
        c: '📛',
        k: ['name', 'badge'],
      },
      {
        c: '🚫',
        k: ['entry'],
      },
      {
        c: '💯',
        k: ['hundred', 'points'],
      },
      {
        c: '💢',
        k: ['anger'],
      },
      {
        c: '♨️',
        k: ['hot', 'springs'],
      },
      {
        c: '🚷',
        k: ['pedestrians'],
      },
      {
        c: '🚯',
        k: ['do', 'not', 'litter'],
      },
      {
        c: '🚳',
        k: ['bicycles'],
      },
      {
        c: '🚱',
        k: ['non', 'potable', 'water'],
      },
      {
        c: '🔞',
        k: ['one', 'under', 'eighteen'],
      },
      {
        c: '📵',
        k: ['mobile', 'phones'],
      },
      {
        c: '🚭',
        k: ['smoking'],
      },
      {
        c: '❗️',
        k: ['heavy', 'exclamation', 'mark'],
      },
      {
        c: '❕',
        k: ['white', 'exclamation', 'mark', 'ornament'],
      },
      {
        c: '❓',
        k: ['black', 'question', 'mark', 'ornament'],
      },
      {
        c: '❔',
        k: ['white', 'question', 'mark', 'ornament'],
      },
      {
        c: '‼️',
        k: ['double', 'exclamation', 'mark'],
      },
      {
        c: '⁉️',
        k: ['exclamation', 'question', 'mark'],
      },
      {
        c: '🔅',
        k: ['low', 'brightness'],
      },
      {
        c: '🔆',
        k: ['high', 'brightness'],
      },
      {
        c: '〽️',
        k: ['part', 'alternation', 'mark'],
      },
      {
        c: '⚠️',
        k: ['warning'],
      },
      {
        c: '🚸',
        k: ['children', 'crossing'],
      },
      {
        c: '🔱',
        k: ['trident', 'emblem'],
      },
      {
        c: '⚜️',
        k: ['fleur', 'de', 'lis'],
      },
      {
        c: '🔰',
        k: ['japanese', 'beginner'],
      },
      {
        c: '♻️',
        k: ['black', 'universal', 'recycling'],
      },
      {
        c: '✅',
        k: ['white', 'heavy', 'check', 'mark'],
      },
      {
        c: '🈯️',
        k: ['squared', 'cjk', 'unified', 'ideograph', '6307'],
      },
      {
        c: '💹',
        k: ['chart', 'upwards', 'trend', 'yen'],
      },
      {
        c: '❇️',
        k: ['sparkle'],
      },
      {
        c: '✳️',
        k: ['eight', 'spoked', 'asterisk'],
      },
      {
        c: '❎',
        k: ['negative', 'squared', 'cross', 'mark'],
      },
      {
        c: '🌐',
        k: ['globe', 'meridians'],
      },
      {
        c: '💠',
        k: ['diamond', 'shape', 'dot', 'inside'],
      },
      {
        c: 'Ⓜ️',
        k: ['circled', 'latin', 'capital', 'letter', 'm'],
      },
      {
        c: '🌀',
        k: ['cyclone'],
      },
      {
        c: '💤',
        k: ['sleeping'],
      },
      {
        c: '🏧',
        k: ['automated', 'teller', 'machine'],
      },
      {
        c: '🚾',
        k: ['water', 'closet'],
      },
      {
        c: '♿️',
        k: ['wheelchair'],
      },
      {
        c: '🅿️',
        k: ['negative', 'squared', 'latin', 'capital', 'letter', 'p'],
      },
      {
        c: '🈳',
        k: ['squared', 'cjk', 'unified', 'ideograph', '7a7a'],
      },
      {
        c: '🈂️',
        k: ['squared', 'katakana', 'sa'],
      },
      {
        c: '🛂',
        k: ['passport', 'control'],
      },
      {
        c: '🛃',
        k: ['customs'],
      },
      {
        c: '🛄',
        k: ['baggage', 'claim'],
      },
      {
        c: '🛅',
        k: ['left', 'luggage'],
      },
      {
        c: '🚹',
        k: ['mens'],
      },
      {
        c: '🚺',
        k: ['womens'],
      },
      {
        c: '🚼',
        k: ['baby'],
      },
      {
        c: '⚧',
        k: ['male', 'stroke', 'female'],
      },
      {
        c: '🚻',
        k: ['restroom'],
      },
      {
        c: '🚮',
        k: ['put', 'litter', 'its', 'place'],
      },
      {
        c: '🎦',
        k: ['cinema'],
      },
      {
        c: '📶',
        k: ['antenna', 'bars'],
      },
      {
        c: '🈁',
        k: ['squared', 'katakana', 'koko'],
      },
      {
        c: '🔣',
        k: ['input', 'symbols'],
      },
      {
        c: 'ℹ️',
        k: ['information', 'source'],
      },
      {
        c: '🔤',
        k: ['input', 'latin', 'letters'],
      },
      {
        c: '🔡',
        k: ['input', 'latin', 'small', 'letters'],
      },
      {
        c: '🔠',
        k: ['input', 'latin', 'capital', 'letters'],
      },
      {
        c: '🆖',
        k: ['squared', 'ng'],
      },
      {
        c: '🆗',
        k: ['squared', 'ok'],
      },
      {
        c: '🆙',
        k: ['squared', 'up', 'exclamation', 'mark'],
      },
      {
        c: '🆒',
        k: ['squared', 'cool'],
      },
      {
        c: '🆕',
        k: ['squared', 'new'],
      },
      {
        c: '🆓',
        k: ['squared', 'free'],
      },
      {
        c: '0️⃣',
        k: ['digit', 'zero'],
      },
      {
        c: '1️⃣',
        k: ['digit', 'one'],
      },
      {
        c: '2️⃣',
        k: ['digit', 'two'],
      },
      {
        c: '3️⃣',
        k: ['digit', 'three'],
      },
      {
        c: '4️⃣',
        k: ['digit', 'four'],
      },
      {
        c: '5️⃣',
        k: ['digit', 'five'],
      },
      {
        c: '6️⃣',
        k: ['digit', 'six'],
      },
      {
        c: '7️⃣',
        k: ['digit', 'seven'],
      },
      {
        c: '8️⃣',
        k: ['digit', 'eight'],
      },
      {
        c: '9️⃣',
        k: ['digit', 'nine'],
      },
      {
        c: '🔟',
        k: ['keycap', 'ten'],
      },
      {
        c: '🔢',
        k: ['input', 'numbers'],
      },
      {
        c: '▶️',
        k: ['black', 'right', 'pointing', 'triangle'],
      },
      {
        c: '⏸',
        k: ['double', 'vertical', 'bar'],
      },
      {
        c: '⏯',
        k: ['black', 'right', 'pointing', 'triangle', 'double', 'vertical'],
      },
      {
        c: '⏹',
        k: ['black', 'square', 'stop'],
      },
      {
        c: '⏺',
        k: ['black', 'circle', 'record'],
      },
      {
        c: '⏭',
        k: ['black', 'right', 'pointing', 'double', 'triangle', 'vertical'],
      },
      {
        c: '⏮',
        k: ['black', 'left', 'pointing', 'double', 'triangle', 'vertical'],
      },
      {
        c: '⏩',
        k: ['black', 'right', 'pointing', 'double', 'triangle'],
      },
      {
        c: '⏪',
        k: ['black', 'left', 'pointing', 'double', 'triangle'],
      },
      {
        c: '🔀',
        k: ['twisted', 'rightwards', 'arrows'],
      },
      {
        c: '🔁',
        k: ['clockwise', 'rightwards', 'leftwards', 'open', 'circle', 'arrows'],
      },
      {
        c: '🔂',
        k: ['clockwise', 'rightwards', 'leftwards', 'open', 'circle', 'arrows'],
      },
      {
        c: '◀️',
        k: ['black', 'left', 'pointing', 'triangle'],
      },
      {
        c: '🔼',
        k: ['up', 'pointing', 'small', 'red', 'triangle'],
      },
      {
        c: '🔽',
        k: ['down', 'pointing', 'small', 'red', 'triangle'],
      },
      {
        c: '⏫',
        k: ['black', 'up', 'pointing', 'double', 'triangle'],
      },
      {
        c: '⏬',
        k: ['black', 'down', 'pointing', 'double', 'triangle'],
      },
      {
        c: '➡️',
        k: ['black', 'rightwards', 'arrow'],
      },
      {
        c: '⬅️',
        k: ['leftwards', 'black', 'arrow'],
      },
      {
        c: '⬆️',
        k: ['upwards', 'black', 'arrow'],
      },
      {
        c: '⬇️',
        k: ['downwards', 'black', 'arrow'],
      },
      {
        c: '↗️',
        k: ['north', 'east', 'arrow'],
      },
      {
        c: '↘️',
        k: ['south', 'east', 'arrow'],
      },
      {
        c: '↙️',
        k: ['south', 'west', 'arrow'],
      },
      {
        c: '↖️',
        k: ['north', 'west', 'arrow'],
      },
      {
        c: '↕️',
        k: ['up', 'down', 'arrow'],
      },
      {
        c: '↔️',
        k: ['left', 'right', 'arrow'],
      },
      {
        c: '↪️',
        k: ['rightwards', 'arrow', 'hook'],
      },
      {
        c: '↩️',
        k: ['leftwards', 'arrow', 'hook'],
      },
      {
        c: '⤴️',
        k: ['arrow', 'pointing', 'rightwards', 'then', 'curving', 'upwards'],
      },
      {
        c: '⤵️',
        k: ['arrow', 'pointing', 'rightwards', 'then', 'curving', 'downwards'],
      },
      {
        c: '🔃',
        k: ['clockwise', 'downwards', 'upwards', 'open', 'circle', 'arrows'],
      },
      {
        c: '🔄',
        k: ['anticlockwise', 'downwards', 'upwards', 'open', 'circle', 'arrows'],
      },
      {
        c: '🔚',
        k: ['end', 'leftwards', 'arrow', 'above'],
      },
      {
        c: '🔙',
        k: ['back', 'leftwards', 'arrow', 'above'],
      },
      {
        c: '🔛',
        k: ['exclamation', 'mark', 'left', 'right', 'arrow', 'above'],
      },
      {
        c: '🔝',
        k: ['top', 'upwards', 'arrow', 'above'],
      },
      {
        c: '🔜',
        k: ['soon', 'rightwards', 'arrow', 'above'],
      },
      {
        c: '✔️',
        k: ['heavy', 'check', 'mark'],
      },
      {
        c: '➕',
        k: ['heavy', 'plus'],
      },
      {
        c: '➖',
        k: ['heavy', 'minus'],
      },
      {
        c: '➗',
        k: ['heavy', 'division'],
      },
      {
        c: '✖️',
        k: ['heavy', 'multiplication', 'x'],
      },
      {
        c: '♾',
        k: ['permanent', 'paper'],
      },
      {
        c: '💲',
        k: ['heavy', 'dollar'],
      },
      {
        c: '💱',
        k: ['currency', 'exchange'],
      },
      {
        c: '™️',
        k: ['trade', 'mark'],
      },
      {
        c: '©️',
        k: ['copyright'],
      },
      {
        c: '®️',
        k: ['registered'],
      },
      {
        c: '〰️',
        k: ['wavy', 'dash'],
      },
      {
        c: '➰',
        k: ['curly', 'loop'],
      },
      {
        c: '➿',
        k: ['double', 'curly', 'loop'],
      },
      {
        c: '🔘',
        k: ['radio', 'button'],
      },
      {
        c: '🔴',
        k: ['large', 'red', 'circle'],
      },
      {
        c: '🟠',
        k: ['large', 'orange', 'circle'],
      },
      {
        c: '🟡',
        k: ['large', 'yellow', 'circle'],
      },
      {
        c: '🟢',
        k: ['large', 'green', 'circle'],
      },
      {
        c: '🔵',
        k: ['large', 'blue', 'circle'],
      },
      {
        c: '🟣',
        k: ['large', 'purple', 'circle'],
      },
      {
        c: '⚫️',
        k: ['medium', 'black', 'circle'],
      },
      {
        c: '⚪️',
        k: ['medium', 'white', 'circle'],
      },
      {
        c: '🟤',
        k: ['large', 'brown', 'circle'],
      },
      {
        c: '🔺',
        k: ['up', 'pointing', 'red', 'triangle'],
      },
      {
        c: '🔻',
        k: ['down', 'pointing', 'red', 'triangle'],
      },
      {
        c: '🔸',
        k: ['small', 'orange', 'diamond'],
      },
      {
        c: '🔹',
        k: ['small', 'blue', 'diamond'],
      },
      {
        c: '🔶',
        k: ['large', 'orange', 'diamond'],
      },
      {
        c: '🔷',
        k: ['large', 'blue', 'diamond'],
      },
      {
        c: '🔳',
        k: ['white', 'square', 'button'],
      },
      {
        c: '🔲',
        k: ['black', 'square', 'button'],
      },
      {
        c: '▪️',
        k: ['black', 'small', 'square'],
      },
      {
        c: '▫️',
        k: ['white', 'small', 'square'],
      },
      {
        c: '◾️',
        k: ['black', 'medium', 'small', 'square'],
      },
      {
        c: '◽️',
        k: ['white', 'medium', 'small', 'square'],
      },
      {
        c: '◼️',
        k: ['black', 'medium', 'square'],
      },
      {
        c: '◻️',
        k: ['white', 'medium', 'square'],
      },
      {
        c: '🟥',
        k: ['large', 'red', 'square'],
      },
      {
        c: '🟧',
        k: ['large', 'orange', 'square'],
      },
      {
        c: '🟨',
        k: ['large', 'yellow', 'square'],
      },
      {
        c: '🟩',
        k: ['large', 'green', 'square'],
      },
      {
        c: '🟦',
        k: ['large', 'blue', 'square'],
      },
      {
        c: '🟪',
        k: ['large', 'purple', 'square'],
      },
      {
        c: '⬛️',
        k: ['black', 'large', 'square'],
      },
      {
        c: '⬜️',
        k: ['white', 'large', 'square'],
      },
      {
        c: '🟫',
        k: ['large', 'brown', 'square'],
      },
      {
        c: '🔈',
        k: ['speaker'],
      },
      {
        c: '🔇',
        k: ['speaker', 'cancellation', 'stroke'],
      },
      {
        c: '🔉',
        k: ['speaker', 'one', 'sound', 'wave'],
      },
      {
        c: '🔊',
        k: ['speaker', 'three', 'sound', 'waves'],
      },
      {
        c: '🔔',
        k: ['bell'],
      },
      {
        c: '🔕',
        k: ['bell', 'cancellation', 'stroke'],
      },
      {
        c: '📣',
        k: ['cheering', 'megaphone'],
      },
      {
        c: '📢',
        k: ['public', 'address', 'loudspeaker'],
      },
      {
        c: '👁‍🗨',
        k: ['eye', 'left', 'speech', 'bubble'],
      },
      {
        c: '💬',
        k: ['speech', 'balloon'],
      },
      {
        c: '💭',
        k: ['thought', 'balloon'],
      },
      {
        c: '🗯',
        k: ['right', 'anger', 'bubble'],
      },
      {
        c: '♠️',
        k: ['black', 'spade', 'suit'],
      },
      {
        c: '♣️',
        k: ['black', 'club', 'suit'],
      },
      {
        c: '♥️',
        k: ['black', 'heart', 'suit'],
      },
      {
        c: '♦️',
        k: ['black', 'diamond', 'suit'],
      },
      {
        c: '🃏',
        k: ['playing', 'card', 'black', 'joker'],
      },
      {
        c: '🎴',
        k: ['flower', 'playing', 'cards'],
      },
      {
        c: '🀄️',
        k: ['mahjong', 'tile', 'red', 'dragon'],
      },
      {
        c: '🕐',
        k: ['clock', 'face', 'one', 'oclock'],
      },
      {
        c: '🕑',
        k: ['clock', 'face', 'two', 'oclock'],
      },
      {
        c: '🕒',
        k: ['clock', 'face', 'three', 'oclock'],
      },
      {
        c: '🕓',
        k: ['clock', 'face', 'four', 'oclock'],
      },
      {
        c: '🕔',
        k: ['clock', 'face', 'five', 'oclock'],
      },
      {
        c: '🕕',
        k: ['clock', 'face', 'six', 'oclock'],
      },
    ],
  },
];

/** Flat index, for search and for resolving a stored reaction key. */
export const ALL: Emoji[] = GROUPS.flatMap((g) => g.items);

const TONEABLE = new Set(GROUPS.filter((g) => g.tone).flatMap((g) => g.items.map((e) => e.c)));

/**
 * Apply a skin tone, if this emoji takes one. The modifier goes after the
 * first codepoint — before any variation selector, which is why this is not
 * a plain concatenation.
 */
export function toned(c: string, tone: Tone): string {
  if (!tone || !TONEABLE.has(c)) return c;
  const cps = [...c];
  const rest = cps.slice(1).filter((x) => x !== '\uFE0F');
  return cps[0]! + TONES[tone] + rest.join('');
}

/** Strip a tone modifier back off, so tone variants share one reaction key. */
const MODIFIERS: string[] = TONES.filter(Boolean);
export function untoned(c: string): string {
  return [...c].filter((x) => !MODIFIERS.includes(x)).join('');
}

/**
 * Search across every group. An empty query returns nothing — the caller
 * shows the grouped view instead, which is faster to scan than a flat list.
 */
export function search(q: string, limit = 90): Emoji[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const starts: Emoji[] = [];
  const contains: Emoji[] = [];
  for (const e of ALL) {
    if (e.k.some((k) => k === needle || k.startsWith(needle))) starts.push(e);
    else if (e.k.some((k) => k.includes(needle))) contains.push(e);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

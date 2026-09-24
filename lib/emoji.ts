// A compact built-in emoji set (no dependency, works offline). Each line is
// "emoji keyword keyword ..." so the picker can search by name.

export interface EmojiEntry {
  emoji: string;
  keywords: string;
}

export interface EmojiCategory {
  id: string;
  label: string;
  /** Emoji shown as this category's tab icon. */
  icon: string;
  items: EmojiEntry[];
}

function parse(lines: string): EmojiEntry[] {
  return lines
    .trim()
    .split("\n")
    .map((line) => {
      const [emoji, ...rest] = line.trim().split(" ");
      return { emoji, keywords: rest.join(" ").toLowerCase() };
    });
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "smileys",
    label: "Smileys",
    icon: "😀",
    items: parse(`
😀 grinning smile happy
😃 smile happy open
😄 smile happy laugh
😁 beaming grin teeth
😆 laughing squint
😅 sweat smile nervous
🤣 rofl rolling laughing lol
😂 joy tears laughing lol
🙂 slight smile
🙃 upside down silly
😉 wink
😊 blush smile happy
😇 angel halo innocent
🥰 love hearts adore
😍 heart eyes love
🤩 star struck wow amazing
😘 kiss blow love
😗 kiss
😚 kiss closed eyes
😋 yum tasty delicious
😛 tongue playful
😜 wink tongue crazy
🤪 zany crazy wild
😝 squint tongue
🤗 hug hugging
🤭 giggle oops hand mouth
🤫 shush quiet secret
🤔 thinking hmm
🤐 zipper mouth secret
🤨 raised eyebrow skeptical
😐 neutral straight
😑 expressionless
😶 no mouth silent
😏 smirk
😒 unamused annoyed
🙄 eye roll
😬 grimace awkward
🤥 lying pinocchio
😌 relieved calm
😔 pensive sad
😪 sleepy tired
🤤 drooling
😴 sleeping zzz sleep
😷 mask sick
🤒 thermometer sick fever
🤕 bandage hurt injured
🤢 nauseated sick
🤮 vomit sick
🥵 hot sweating
🥶 cold freezing
🥴 woozy dizzy
😵 dizzy knocked out
🤯 mind blown exploding
🤠 cowboy hat
🥳 party celebrate birthday
😎 cool sunglasses
🤓 nerd glasses
🧐 monocle curious
😕 confused
😟 worried
🙁 frown sad
☹️ frown sad
😮 open mouth surprised
😯 hushed surprised
😲 astonished shocked
😳 flushed embarrassed
🥺 pleading puppy eyes please
😦 frowning
😧 anguished
😨 fearful scared
😰 anxious sweat
😥 sad relieved
😢 cry sad tear
😭 sobbing crying loud
😱 scream fear shocked
😖 confounded
😣 persevering
😞 disappointed
😓 downcast sweat
😩 weary tired
😫 tired exhausted
🥱 yawn bored
😤 triumph huff angry
😡 angry mad red
😠 angry mad
🤬 cursing swearing
😈 devil smiling imp
👿 devil angry
💀 skull dead
💩 poop
🤡 clown
👻 ghost
👽 alien
🤖 robot
`),
  },
  {
    id: "people",
    label: "People",
    icon: "👍",
    items: parse(`
👋 wave hello hi bye
🤚 raised hand stop
🖐️ hand fingers
✋ high five stop hand
🖖 vulcan spock
👌 ok okay perfect
🤌 pinched fingers italian
🤏 pinch small
✌️ victory peace
🤞 crossed fingers luck hope
🤟 love you hand
🤘 rock horns
🤙 call me shaka
👈 point left
👉 point right
👆 point up
👇 point down
☝️ point up index
👍 thumbs up like yes good
👎 thumbs down dislike no
✊ fist raised
👊 fist bump punch
🤛 left fist bump
🤜 right fist bump
👏 clap applause bravo
🙌 raised hands celebrate hooray
👐 open hands
🤲 palms up together
🤝 handshake deal agreement
🙏 pray thanks please folded hands
✍️ writing hand
💅 nail polish
🤳 selfie
💪 muscle strong flex biceps
🦾 mechanical arm
👀 eyes look watching
👁️ eye
👅 tongue
👄 mouth lips
🧠 brain smart
🫀 heart organ
🦷 tooth
👶 baby
🧒 child
👦 boy
👧 girl
🧑 person adult
👨 man
👩 woman
🧓 older person
👴 old man
👵 old woman
👨‍💻 man technologist developer coder
👩‍💻 woman technologist developer coder
👨‍💼 man office worker business
👩‍💼 woman office worker business
🕵️ detective spy
💁 information desk person
🙋 raising hand
🤦 facepalm
🤷 shrug
🙅 no gesture
🙆 ok gesture
🙇 bow sorry
🚶 walking
🏃 running
💃 dancer dance
🕺 dancing man dance
👯 dancers party
`),
  },
  {
    id: "hearts",
    label: "Hearts and symbols",
    icon: "❤️",
    items: parse(`
❤️ red heart love
🧡 orange heart
💛 yellow heart
💚 green heart
💙 blue heart
💜 purple heart
🖤 black heart
🤍 white heart
🤎 brown heart
💔 broken heart sad
❣️ heart exclamation
💕 two hearts love
💞 revolving hearts
💓 beating heart
💗 growing heart
💖 sparkling heart
💘 heart arrow cupid
💝 heart gift ribbon
💯 hundred perfect score
💢 anger
💥 boom collision
💫 dizzy stars
💦 sweat droplets water
💨 dash wind fast
💬 speech bubble chat message
💭 thought bubble
🔥 fire hot lit
✨ sparkles shine new
⭐ star
🌟 glowing star
⚡ lightning bolt fast
🎉 party popper celebrate congratulations
🎊 confetti ball
🏆 trophy winner
🥇 gold medal first
🎯 target bullseye goal
✅ check mark done yes
❌ cross no wrong
❗ exclamation
❓ question
‼️ double exclamation
⚠️ warning caution
🚫 prohibited no
⏰ alarm clock time
⏳ hourglass waiting
🔔 bell notification
🔕 bell muted silent
📌 pin pushpin
🔒 lock secure
🔑 key
`),
  },
  {
    id: "nature",
    label: "Animals and nature",
    icon: "🐶",
    items: parse(`
🐶 dog puppy
🐱 cat kitten
🐭 mouse
🐹 hamster
🐰 rabbit bunny
🦊 fox
🐻 bear
🐼 panda
🐨 koala
🐯 tiger
🦁 lion
🐮 cow
🐷 pig
🐸 frog
🐵 monkey
🙈 see no evil monkey
🙉 hear no evil monkey
🙊 speak no evil monkey
🐔 chicken
🐧 penguin
🐦 bird
🦅 eagle
🦉 owl
🦋 butterfly
🐝 bee
🐞 ladybug
🐢 turtle
🐍 snake
🐙 octopus
🐠 fish tropical
🐬 dolphin
🐳 whale
🦈 shark
🐘 elephant
🦒 giraffe
🐎 horse
🦄 unicorn
🌸 cherry blossom flower
🌹 rose flower
🌻 sunflower
🌷 tulip
🌱 seedling plant
🌳 tree
🌴 palm tree
🍀 four leaf clover luck
🌈 rainbow
☀️ sun sunny
🌙 moon crescent night
⛅ cloud sun
☁️ cloud
🌧️ rain
⛈️ storm thunder
❄️ snowflake snow cold
🌊 wave ocean sea
`),
  },
  {
    id: "food",
    label: "Food and drink",
    icon: "🍕",
    items: parse(`
🍎 apple red
🍏 apple green
🍊 orange tangerine
🍋 lemon
🍌 banana
🍉 watermelon
🍇 grapes
🍓 strawberry
🍒 cherries
🍑 peach
🥭 mango
🍍 pineapple
🥥 coconut
🥑 avocado
🍅 tomato
🥕 carrot
🌽 corn
🥔 potato
🍞 bread
🥐 croissant
🧀 cheese
🍳 egg cooking breakfast
🥓 bacon
🍔 burger hamburger
🍟 fries
🍕 pizza
🌭 hot dog
🌮 taco
🌯 burrito
🥗 salad
🍝 pasta spaghetti
🍜 ramen noodles
🍣 sushi
🍛 curry
🍚 rice
🍦 ice cream
🍩 donut
🍪 cookie
🎂 birthday cake
🍰 cake slice
🍫 chocolate
🍿 popcorn
☕ coffee tea hot
🍵 tea green
🍺 beer
🍻 cheers beers
🥂 champagne cheers
🍷 wine
🍸 cocktail
🥤 cup soda
🧃 juice box
💧 water drop
`),
  },
  {
    id: "activity",
    label: "Activity",
    icon: "⚽",
    items: parse(`
⚽ soccer football
🏀 basketball
🏈 american football
⚾ baseball
🎾 tennis
🏐 volleyball
🏏 cricket
🎱 pool billiards
🏓 ping pong
🥊 boxing glove
🏋️ weight lifting gym
🚴 cycling bike
🏊 swimming
🧘 yoga meditation
🎮 video game controller
🎲 dice game
🎯 dart target
🎳 bowling
🎸 guitar
🎹 piano keyboard
🥁 drum
🎤 microphone sing karaoke
🎧 headphones music
🎬 clapper movie film
🎨 art palette paint
🎭 theater masks
🎫 ticket
📚 books study
🏆 trophy
🥇 medal gold
`),
  },
  {
    id: "travel",
    label: "Travel and places",
    icon: "🚗",
    items: parse(`
🚗 car auto
🚕 taxi
🚌 bus
🚎 trolleybus
🏎️ race car fast
🚓 police car
🚑 ambulance
🚒 fire truck
🚚 delivery truck
🚲 bicycle bike
🛵 scooter
🏍️ motorcycle
🚆 train
🚇 metro subway
✈️ airplane flight plane
🛫 takeoff departure
🛬 landing arrival
🚀 rocket launch startup
🛸 ufo
🚢 ship
⛵ sailboat
⚓ anchor
🏠 house home
🏢 office building
🏥 hospital
🏦 bank
🏨 hotel
🏪 store shop
🏫 school
🌍 earth globe world
🗺️ map
🧭 compass
🏖️ beach
🏝️ island
🏔️ mountain
🌆 city sunset
🌃 night city
🗽 statue of liberty
🗼 tower
`),
  },
  {
    id: "objects",
    label: "Objects",
    icon: "💡",
    items: parse(`
📱 phone mobile
☎️ telephone
📞 phone receiver call
📟 pager
💻 laptop computer
🖥️ desktop computer
⌨️ keyboard
🖱️ mouse computer
🖨️ printer
📷 camera
📸 camera flash photo
🎥 movie camera video
📺 tv television
📻 radio
🔋 battery
🔌 plug electric
💡 light bulb idea
🔦 flashlight
📧 email
📨 incoming envelope
✉️ envelope mail
📦 package box delivery
📬 mailbox
📝 memo note write
📄 page document
📃 page curl
📋 clipboard
📅 calendar date
📆 calendar tear off
📈 chart up growth
📉 chart down decline
📊 bar chart
📎 paperclip attachment
🔗 link chain
✂️ scissors
🖇️ paperclips linked
📐 ruler triangle
🔍 magnifying glass search
🔎 magnifying glass right
💼 briefcase business
👔 necktie business
🎁 gift present
🎈 balloon party
💰 money bag
💵 dollar cash
💳 credit card
🧾 receipt
⚖️ scale balance legal
🔧 wrench tool
🔨 hammer
🛠️ tools
`),
  },
];

export const ALL_EMOJI: EmojiEntry[] = EMOJI_CATEGORIES.flatMap((c) => c.items);

export function searchEmoji(query: string): EmojiEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const seen = new Set<string>();
  return ALL_EMOJI.filter((e) => {
    if (seen.has(e.emoji)) return false;
    const match = words.every((w) => e.keywords.includes(w));
    if (match) seen.add(e.emoji);
    return match;
  });
}

const RECENT_KEY = "dialer_recent_emoji";
const MAX_RECENT = 24;

export function loadRecentEmoji(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(emoji: string): string[] {
  const next = [emoji, ...loadRecentEmoji().filter((e) => e !== emoji)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: recents just are not remembered.
  }
  return next;
}

// True for a message made only of 1 to 3 emoji, which chat apps show big and
// without a bubble. Uses the grapheme segmenter so a family or flag counts as
// one emoji.
export function isEmojiOnly(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 40) return false;
  if (!/^[\p{Extended_Pictographic}‍️\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}\s]+$/u.test(t)) return false;
  if (!/\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]/u.test(t)) return false;
  const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  const count = segmenter ? Array.from(segmenter.segment(t.replace(/\s+/g, ""))).length : Array.from(t.replace(/\s+/g, "")).length;
  return count >= 1 && count <= 3;
}

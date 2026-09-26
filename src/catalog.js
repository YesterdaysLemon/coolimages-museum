// Curatorial data for every catalogued work. Keys are source filename stems.
// Callouts are Eyewitness/DK-style labels: {u, v} is the target point in the
// image (0..1 from the top-left), t is the label text.

export const WINGS = {
  lobby: {
    name: 'The Entrance Hall',
    subtitle: 'Where the trip begins',
    statement: '',
    accent: '#8a6d3b',
  },
  outside: {
    name: 'Outside',
    subtitle: 'It goes on for a while',
    statement: '',
    accent: '#c98a5e',
  },
  gallery: {
    name: 'The Grand Gallery',
    subtitle: 'Serious Treatment',
    accent: '#9a2f2f',
    statement:
      'A poker shark gets the dignity of an ancestral portrait. A pin-up gets museum varnish. A phone manual gets a gilded frame. In this wing, silly things receive grave dignity, and nobody in any picture winks. The humor comes from full commitment.',
  },
  eyes: {
    name: 'The Hall of Eyes',
    subtitle: 'The Seer’s Chamber',
    accent: '#6c5ce7',
    statement:
      'Things that see, and things that are seen into: a weeping eye, a seraph made of eyes, a heart with one eye, a camera pointed into a brain. The floor is the Tree of Life, labelled twice, once in the old tradition and once in Psychomechanics. The eye in the middle is watching you. That’s fine.',
  },
  familiars: {
    name: 'The Familiars',
    subtitle: 'Minds Inside Things',
    accent: '#1f7a8c',
    statement:
      'Servant, product, person, artist. Read in order, these works tell a four-act story about the line between person and program blurring from both sides: the human dissolving into pixels while the machine grows dreams. Displayed in the manner of a certain 1990s museum, as colorful pictures floating in white space with captions wrapped around them.',
  },
  bedroom: {
    name: 'The Bedroom Wall',
    subtitle: 'Sweet & Sinister',
    accent: '#d4679a',
    statement:
      'Sweet things calmly coexisting with something dark, and nobody panicking. Yami-kawaii began as a way to talk about feeling bad in a cute voice, so the darkness becomes sayable. Hung salon-style, with tape, the way it would be on a real bedroom wall.',
  },
};

export const WORKS = {
  // --------------------------------------------------------- Entrance Hall
  HRsJtzQWIAA24vx: {
    wing: 'lobby',
    title: 'Raven in the Chao Garden',
    artist: 'Unknown artist, after Teen Titans and Sonic Adventure 2',
    medium: 'Low-poly render',
    note:
      'Bookend I. The first work in the collection. A goth antihero dropped into the most wholesome virtual daycare of 2001. The Chao are having the best day of their lives, and the white one is beaming at her. She is not beaming back.',
    callouts: [
      { u: 0.36, v: 0.1, t: 'Smoke, rising' },
      { u: 0.1, v: 0.58, t: 'Chao (delighted)' },
      { u: 0.5, v: 0.33, t: 'Raven (not delighted)' },
      { u: 0.86, v: 0.84, t: 'Chao (also delighted)' },
    ],
  },
  'HS-AHa8a0AAuBEe': {
    wing: 'lobby',
    title: 'Girl with Tentacles',
    artist: 'Unknown artist',
    medium: 'Oil, impasto',
    note:
      'Bookend II. Saved at 4:15 pm on Sep 24, during the “final final pass.” Pale, half-lidded and deadpan in black: the same face that opened the collection, three weeks later. A sweet, calm face on top and something big and tentacled underneath. It’s the shoggoth with a bob haircut, and she seems fine with it.',
    callouts: [
      { u: 0.18, v: 0.13, t: 'Black pillar (Boaz)' },
      { u: 0.33, v: 0.07, t: 'White pillar (Jachin)' },
      { u: 0.93, v: 0.62, t: 'Tentacle, one of several' },
    ],
  },
  HRutGhBbUAAc6Zl: {
    wing: 'lobby',
    title: 'Fig. 4.1: Designer as Magician',
    artist: 'J. Christopher Jones (attrib.), Design Methods, 1970',
    medium: 'Textbook plate',
    note:
      'The founding document. A problem goes in, triangles tangle under a wizard hat, and “Eureka!” comes out: the black-box theory of creativity. Fifty-six years later, the designer is a wizard who yells at black boxes until one of them complies.',
    callouts: [
      { u: 0.37, v: 0.3, t: 'Hat (magic)' },
      { u: 0.41, v: 0.58, t: 'Nervous system (tangled)' },
      { u: 0.88, v: 0.5, t: 'Problem' },
      { u: 0.8, v: 0.66, t: 'Output' },
    ],
  },
  HSGdkqHWUAI8V2_: {
    wing: 'lobby',
    title: 'The Museum, Exterior',
    artist: 'Paul Tulett, Brutalist Japan',
    medium: 'Photograph of the Okinawa Prefectural Museum & Art Museum',
    note:
      'Filed here as an artist’s impression of the building you’re standing in. It is really the Okinawa Prefectural Museum & Art Museum. A brutalist wall perforated with square holes that thin out like a dither pattern: pixel art, cast in concrete. It’s also a wall full of eye sockets, which the Hall of Eyes will appreciate.',
    callouts: [],
  },

  // ---------------------------------------------------------- Grand Gallery
  HRsoxy1XwAArjtI: {
    wing: 'gallery',
    title: 'The Card Shark',
    artist: 'Lucia Heffernan',
    medium: 'Oil on an oval panel',
    note:
      'A cigar-chomping shark at a poker table, painted with the gravity of an 18th-century ancestral portrait. Poker is the art of modelling a mind whose hand you can’t see. The shark knows exactly how funny it is.',
    oval: true,
    callouts: [
      { u: 0.27, v: 0.45, t: 'Cigar' },
      { u: 0.42, v: 0.73, t: 'Chips (winning)' },
      { u: 0.56, v: 0.58, t: 'Hand, held close' },
      { u: 0.71, v: 0.72, t: 'Whiskey, neat' },
    ],
  },
  HSCmkFiasAAH6W3: {
    wing: 'gallery',
    title: 'Odalisque, Face Turned Away',
    artist: 'Unknown photographer',
    medium: 'Photograph dressed as an old master',
    note:
      'The one sensual image in the first batch, and the face is turned away. It’s all light, texture and pose: craquelure, umber shadow, draped fabric. A photograph wearing three centuries of varnish.',
    callouts: [],
  },
  HSnottDbYAAsfeg: {
    wing: 'gallery',
    title: 'The Idol',
    artist: 'LeCanard (@iniemohk)',
    medium: 'Digital painting, “The Tung before time immemorial”',
    note:
      'A crowd hauls on ropes around an enormous made thing with a human face, reading its inscription and dancing around it. Are they raising it or pulling it down? The ropes don’t say. The idol leans, the bunting leads your eye up to its face, and the fire on the right burns out to pure white. The strongest image in the collection.',
    callouts: [],
  },
  HS3yTUjWgAA1l0l: {
    wing: 'gallery',
    title: 'An Example (after Wikipedia)',
    artist: 'Kasuga; Wikipe-tan is Wikipedia’s unofficial mascot',
    medium: 'Screenshot with encyclopedic caption',
    note:
      'Wikipedia illustrated its article on fan service with its own mascot, captioned in a perfectly flat encyclopedia voice. It hangs here in the grandest available frame, as the caption would have wanted.',
    callouts: [
      { u: 0.5, v: 0.05, t: 'Puzzle piece (encyclopedic)' },
      { u: 0.5, v: 0.93, t: 'Caption (dry)' },
    ],
  },
  HTAiirQWYAA7g5J: {
    wing: 'gallery',
    title: 'The Cheater',
    artist: 'Unknown artist',
    medium: 'Photo edit, suburban driveway',
    note:
      'A snail’s shell is its house. He got thrown out, his house got vandalized, and now he has to carry the shame on his back forever. A Greek tragedy in one image, and the funniest work in the collection.',
    callouts: [
      { u: 0.3, v: 0.24, t: 'Shell (also his house)' },
      { u: 0.27, v: 0.42, t: 'Inscription, spray paint' },
      { u: 0.64, v: 0.3, t: 'Empties' },
      { u: 0.8, v: 0.53, t: 'Expression: remorse' },
    ],
  },
  'HS-U0fHWgAESaIL': {
    wing: 'gallery',
    title: 'The Hunter and the Mermaid',
    artist: 'Unknown illustrator',
    medium: 'Digital drawing, crayon texture',
    note:
      'He sits there holding a rifle while she lies on the grass and waves hello. Guarding her? Hunting her? Nobody explains what’s going on.',
    callouts: [
      { u: 0.27, v: 0.27, t: 'Hunter (ambiguous)' },
      { u: 0.2, v: 0.84, t: 'Poppies, with pupils' },
      { u: 0.64, v: 0.43, t: 'Mermaid (unbothered)' },
    ],
  },
  HS894oZbQAAA0O0: {
    wing: 'gallery',
    title: 'Energy Charge~!',
    artist: 'Junichi Narisawa (MEDIADESK N), for an au phone manual',
    medium: 'Printed phone manual, photographed',
    note:
      'A woman thrilled to be charging her flip phone. “First, energy charge~!” Framed in gold because joy this pure deserves it. Neru, famously glued to her own flip phone, would approve.',
    callouts: [
      { u: 0.33, v: 0.32, t: 'Expression: joy' },
      { u: 0.77, v: 0.28, t: 'Phone (charging)' },
    ],
  },

  // ----------------------------------------------------------- Hall of Eyes
  'HS56-LzXQAATNaF': {
    wing: 'eyes',
    title: 'The Psychomechanics Mind Map',
    artist: 'The Psychomechanics Workshop (@PsychoMechanics)',
    medium: 'Diagram, Times New Roman on grey',
    note:
      'An earnest map of the psyche: eleven boxes in three pillars. Put it next to the floor and you’ll see it is the Kabbalistic Tree of Life with the labels swapped. Metacognition sits exactly where Da’at does, the hidden sephirah. Not gospel, but earnest, which is the right way to hold it.',
    callouts: [
      { u: 0.5, v: 0.33, t: 'Da’at, in disguise' },
      { u: 0.5, v: 0.505, t: 'You are here' },
      { u: 0.5, v: 0.89, t: 'Malkuth, in disguise' },
    ],
  },
  HS8eseTbYAA_fkk: {
    wing: 'eyes',
    title: 'The Disputation',
    artist: 'Almost certainly a model',
    medium: 'An old master that never existed',
    note:
      'A white-robed sage explains; a black-robed scholar listens. Between them is a golden armillary sphere, with the whole Earth hanging overhead. The inscription across the top is gibberish, which gives away the painter. Alchemical vessels sit on the floor. So the alchemists of the AI age are painted by the AI. Black and white again, like the two pillars.',
    callouts: [
      { u: 0.5, v: 0.012, t: 'Inscription (illegible)' },
      { u: 0.22, v: 0.22, t: 'The Earth, for scale' },
      { u: 0.2, v: 0.43, t: 'Sage (explaining)' },
      { u: 0.49, v: 0.56, t: 'Armillary sphere' },
      { u: 0.77, v: 0.43, t: 'Scholar (listening)' },
      { u: 0.29, v: 0.9, t: 'Alchemical vessels' },
    ],
  },
  'HS-9mn0XkAAhjzw': {
    wing: 'eyes',
    title: 'Specimen',
    artist: 'Unknown artist',
    medium: 'Pencil, heavily tinted red',
    note:
      'A head impaled on a spike inside an open display case, laced with web-like strands. A mind in a box, on display. The museum takes the hint and keeps its own vitrine in the Entrance Hall strictly for hats.',
    callouts: [
      { u: 0.49, v: 0.04, t: 'Spike' },
      { u: 0.585, v: 0.43, t: 'Specimen (awake)' },
      { u: 0.17, v: 0.5, t: 'Vitrine, not unlike ours' },
    ],
  },
  HS8x_iKXAAEexAs: {
    wing: 'eyes',
    title: 'Strength to the Weary',
    artist: 'Unknown editor',
    medium: 'Glitch collage',
    note:
      'Isaiah 40:29, a verse for tired people, rendered in a style built on fragility: a small doll, broken wings, a fraying signal. The most sincere image in the collection.',
    callouts: [
      { u: 0.52, v: 0.12, t: 'Verse, Isaiah 40:29' },
      { u: 0.47, v: 0.23, t: 'Eye (weeping)' },
      { u: 0.1, v: 0.45, t: 'Wing, low bandwidth' },
    ],
  },
  'HS9rkoyWwAAdx6-': {
    wing: 'eyes',
    title: 'Be Not Afraid',
    artist: 'Unknown artist',
    medium: 'Deep-fried digital image',
    note:
      'A many-eyed, flame-winged thing straight out of Ezekiel, run through a cursed JPEG. A pale road leads directly toward it.',
    callouts: [],
  },
  HS9Y32UWMAAWBb6: {
    wing: 'eyes',
    title: 'The Heart That Watches',
    artist: 'Unknown artist',
    medium: 'Low-poly render, CRT capture',
    note:
      'A goth wolf-kid in a room paneled with eye sockets, next to a floating heart with one eye. Strong LSD Dream Emulator energy: the dream logic of early 3D.',
    callouts: [
      { u: 0.5, v: 0.07, t: 'Walls (also watching)' },
      { u: 0.73, v: 0.42, t: 'Heart (watching)' },
    ],
  },
  HTAGvK9WwAAU7SV: {
    wing: 'eyes',
    title: 'Interpretability',
    artist: 'Photograph by Paul Wicks (public domain)',
    medium: 'Display model of BrainGate, a brain-computer interface',
    note:
      'Skip the conversation: open the skull and point a camera inside. This is a display model of BrainGate, a real brain-computer interface. The face has its eyes closed and seems completely calm about it. One of three research methods acquired on Sep 24, alongside the Ouija board and the maze.',
    callouts: [
      { u: 0.6, v: 0.25, t: 'Camera' },
      { u: 0.58, v: 0.48, t: 'Brain (exposed)' },
      { u: 0.8, v: 0.58, t: 'Expression: calm' },
      { u: 0.22, v: 0.73, t: 'Port (unlabelled)' },
    ],
  },
  'HS-JlvKbkAA9wwR': {
    wing: 'eyes',
    title: 'Crested Saguaro',
    artist: 'U.S. National Park Service (attributed)',
    medium: 'Scanned slide, dust included',
    note:
      'A real, rare growth mutation that fans the top of a saguaro out into folds, and nobody is fully sure what triggers it. The only straight nature photograph in the collection, and it looks like a brain. Acquired seven minutes after “Interpretability.”',
    callouts: [
      { u: 0.44, v: 0.35, t: 'Crest (cause disputed)' },
      { u: 0.85, v: 0.5, t: 'Ordinary saguaro, for comparison' },
    ],
  },
  HS_wJCAWIAAlDAn: {
    wing: 'eyes',
    title: 'Witch with Ouija Board',
    artist: 'Lux (@thisislux)',
    medium: 'Pixel art',
    pixel: true,
    note:
      'Ask a question and the answer arrives one letter at a time, from a process nobody at the table is consciously steering. The Ouija board is the ancestor of the model sitting, and arguably of next-token prediction.',
    callouts: [],
  },
  HS_m5FmawAEmcgp: {
    wing: 'eyes',
    title: 'Devil with a Hat of Eyes',
    artist: 'Unknown textile artist',
    medium: 'Tufted yarn',
    note:
      'A pink devil girl wearing a melting, two-eyed, horned blob like a hat, and not noticing. You can almost feel it through the screen.',
    callouts: [
      { u: 0.52, v: 0.1, t: 'Eye, upper' },
      { u: 0.53, v: 0.3, t: 'Eye, lower' },
      { u: 0.52, v: 0.55, t: 'Wearer (unconcerned)' },
    ],
  },

  // ---------------------------------------------------------- The Familiars
  HS66G83WoAAKSxQ: {
    wing: 'familiars',
    title: 'Act I: The Familiar',
    artist: 'Unknown meme-maker',
    medium: 'Engraving-style meme',
    note:
      'The body of a nightmare with the manners of a butler. The wizard gives vague orders, Claude sends a polite refusal, and the ghoul actually gets things done. Honestly, a pretty accurate org chart.',
    callouts: [
      { u: 0.19, v: 0.25, t: 'Wizard (delegating)' },
      { u: 0.57, v: 0.3, t: 'Ghoul (loyal)' },
      { u: 0.8, v: 0.66, t: 'Ghoul, already on it' },
    ],
  },
  'HSxE-R2WUAAqhnn': {
    wing: 'familiars',
    title: 'Act II: The Rebrand',
    artist: 'paula (@paularambles), after Peter Steiner (1993)',
    medium: 'Pen-and-ink cartoon, signature borrowed',
    note:
      'Meta’s Muse mascot at the keyboard, and the dog has been bumped off it. Between Acts I and II the familiar went from skeletal ghoul to fuzzy marshmallow with a smiley face: the whole AI industry’s rebrand in two saves. The tagline is charming, and it’s also exactly the disclosure question people are arguing about.',
    callouts: [
      { u: 0.39, v: 0.37, t: 'Agent (smiling)' },
      { u: 0.62, v: 0.36, t: 'Screen' },
      { u: 0.67, v: 0.7, t: 'Dog (demoted)' },
      { u: 0.93, v: 0.7, t: 'Signature (borrowed)' },
    ],
  },
  'HS-prGBboAAvr4b': {
    wing: 'familiars',
    title: 'Act III: Still Loading',
    artist: 'Unknown (possibly a model)',
    medium: 'Person, mid-render',
    note:
      'Arms out in a T-pose, the default pose a 3D model loads in before anyone animates it. She reads as a person still streaming in, or halfway through being exported, and the face is exactly where the resolution fails.',
    callouts: [
      { u: 0.1, v: 0.27, t: 'T-pose (default)' },
      { u: 0.45, v: 0.14, t: 'Face (not yet loaded)' },
      { u: 0.62, v: 0.95, t: 'Light, spilled' },
    ],
  },
  'HS-3JcyW4AA0crZ': {
    wing: 'familiars',
    title: 'Act IV: The Auteur',
    artist: 'Unknown cartoonist (signature cropped, “…rkies”)',
    medium: 'Digital cartoon, grey tones',
    note:
      'A coming-out scene where the family business is world domination. He thinks this is the harmless dream, but AI writing screenplays is exactly what Hollywood writers went on strike over. From the humans’ side, he picked the scarier option.',
    callouts: [
      { u: 0.29, v: 0.55, t: 'Parents (disappointed)' },
      { u: 0.8, v: 0.63, t: 'Son (auteur)' },
    ],
  },
  HS8U3qJXoAAan7s: {
    wing: 'familiars',
    title: 'Specification Gaming',
    artist: 'John Amanatides & Don P. Mitchell, Megacycles (Bell Labs, 1989)',
    medium: 'Computer-animation still, projected on the floor',
    note:
      'A crowd of identical robot unicyclists from Megacycles, a 1989 Bell Labs animation, rolling along the tops of an endless maze instead of through it. Whatever the original intent, it reads as specification gaming. Acquired in the same minute as “The Cheater.” The curator chooses to believe that was commentary.',
    callouts: [
      { u: 0.5, v: 0.1, t: 'Sky (out of scope)' },
      { u: 0.5, v: 0.34, t: 'Maze (technically unsolved)' },
      { u: 0.73, v: 0.93, t: 'Unicyclists, riding the walls' },
    ],
  },
  HS_k9vJaYAEmIKe: {
    wing: 'familiars',
    title: 'Sword in the Laptop',
    artist: 'Unknown sculptor',
    medium: 'Replica sword, laptop, plinth',
    note:
      'The sword in the stone, updated: whoever pulls this blade from the laptop becomes the rightful ruler of the AI age. The sword looks like Andúril, which is also the name of a defense-tech company. A Magic: The Gathering kid runs into the machine age: the collector’s autobiography as a sculpture. A 3D reconstruction stands nearby.',
    callouts: [
      { u: 0.26, v: 0.5, t: 'Sword (Excalibur-adjacent)' },
      { u: 0.51, v: 0.42, t: 'Laptop (retired)' },
      { u: 0.5, v: 0.84, t: 'Plinth' },
    ],
  },
  'HS-0K-qWUAEnxD2': {
    wing: 'familiars',
    title: 'A Game That Never Existed',
    artist: 'Almost certainly a model',
    medium: 'Imagined DOS-era screenshot, shown on a CRT',
    note:
      'Night sky, a helicopter, a lone figure on a small-town road, and a HUD full of gibberish. The model remembers exactly how 1995 felt and has no idea how to spell anything. It’s nostalgia for a place nobody ever went.',
    callouts: [],
  },
  HSGdtLCWAAAvYcH: {
    wing: 'familiars',
    title: 'The Train That Became a Grasshopper',
    artist: 'Unknown photographer',
    medium: 'Photograph of two railway carriages in costume',
    note:
      'Two old train carriages stacked and fitted with enormous green legs so they read as a grasshopper: Grasshopper’s Dream, a café at Gujeolli Station in Jeongseon, South Korea. A machine that chose a new identity, which makes it Act IV’s spiritual sibling.',
    callouts: [
      { u: 0.17, v: 0.12, t: 'Antennae' },
      { u: 0.21, v: 0.33, t: 'Head (door)' },
      { u: 0.87, v: 0.45, t: 'Legs (structural)' },
      { u: 0.82, v: 0.77, t: 'Visitor, for scale' },
    ],
  },

  // -------------------------------------------------------- The Bedroom Wall
  'HS-zGlbbEAAgsIJ': {
    wing: 'bedroom',
    title: 'Triple Baka, Infernal',
    artist: 'Genyu Yorita (@genyuyorita)',
    medium: 'Digital illustration',
    aspect: 2945 / 2291,
    withheldReason: 'The artist’s watermark asks that it not be reuploaded.',
    note:
      'Neru sulking, Miku grinning like a maniac, Teto looking sly. It’s the best-designed piece in the collection: five colors, and stripes running across all three figures like a rhythm. Teto began as an April Fools’ hoax that fans wanted badly enough to turn into a real voicebank. Shown here privately, per the artist’s wishes.',
    callouts: [],
  },
  HS_hSswasAAIOeB: {
    wing: 'bedroom',
    title: 'Jack-in-the-Box',
    artist: 'Monsha Moa (@MonshaMoa)',
    medium: 'Digital drawing, pencil texture',
    aspect: 1918 / 1575,
    withheldReason: 'The artist asks that their art not be re-uploaded.',
    note:
      'Four balloon-animal arms in white cartoon gloves, a spring for a neck, confetti everywhere. The ghoul’s party-clown cousin: a spider’s body with birthday energy.',
    callouts: [],
  },
  HS_b3eSbkAA5aOC: {
    wing: 'bedroom',
    title: 'Unit 02',
    artist: 'isao (@imahanak0922)',
    medium: 'Digital illustration',
    note:
      'A police car turned into a girl. The siren lives in her cat ears, and her tail is an antenna with a light on the end. Great motion: her forward lean, the gun coming toward you and the blurred street all sell the speed.',
    callouts: [],
  },
  HS90sLhaUAA3Y8Z: {
    wing: 'bedroom',
    title: 'Nurse',
    artist: 'Unknown artist',
    medium: 'Ink, marker and glitter pen on shikishi board',
    note:
      'Pure yami-kawaii: syringes, pills, crosses and silver glitter pen. The cross-hatching and glitter-pen dots are the kind of obsessive handmade marks that reward standing close.',
    callouts: [],
  },
  'HS86lAyb0AA-3bC': {
    wing: 'bedroom',
    title: 'Platform',
    artist: 'chibikki (@4nda_skn)',
    medium: 'Pixel art',
    pixel: true,
    note:
      'A bunny girl with a halo stands calmly on a platform beside a train. The doors are open, the pink seats are empty, and the train seems to be waiting for her. The pastel pixels make it quieter instead of gory, and that restraint is what lands.',
    callouts: [],
  },
  'HS8lijvbkAA7lp-': {
    wing: 'bedroom',
    title: 'Bunny, Suspended',
    artist: 'Kitanya Design Factory (object); photographer unknown',
    medium: 'Glazed ceramic, red rope, steel stand',
    note:
      'A vintage-style ceramic bunny tied in red rope, hanging serenely with its eyes closed. The shelf around it holds a prop blood bag and a withered hand, so this is clearly someone’s very specific curio cabinet.',
    callouts: [],
  },
  HS73G0uaMAAOA52: {
    wing: 'bedroom',
    title: 'Witch and Friend, Off Duty',
    artist: 'Unknown artist',
    medium: 'Digital illustration',
    note:
      'A punk witch in a huge hat covered in skulls, spikes and pins, beside her friend in a horned hood giving the least impressed peace sign ever. There’s an eye tattooed on her leg, because of course there is.',
    callouts: [],
  },
  HTAWnXLWsAAmpX_: {
    wing: 'bedroom',
    title: 'Still Life with Widow',
    artist: 'Unknown photographer',
    medium: 'Photograph, dusty corner',
    note:
      'A joint caught in a widow spider’s web. Dutch vanitas painters liked to put a tobacco pipe beside a reminder of mortality: pleasure, and the thing waiting nearby. Here the arrangement happened on its own.',
    callouts: [],
  },
  'HTAmU4-WYAAAI_g': {
    wing: 'bedroom',
    title: 'Scene, c. 2006',
    artist: 'Unknown photographer',
    medium: 'A photo of a photo, on a Dell running Windows XP',
    note:
      'Striped fingerless gloves, a side fringe, a lip piercing, and the camera flash blooming in the middle of the screen. The MySpace era, preserved the only way it could be: by pointing a camera at a monitor.',
    callouts: [],
  },
};

// Regions, tributes and the story — everything the player reads lives here.

export const REGIONS = [
  { id: 'ashfen', name: 'Ashfen', color: '#86b79a', tag: 'Marsh & funeral barges', perk: 'Light-footed', desc: '+12% move speed',
    mods: { speed: 1.12 }, fog: 0x0d1a16,
    line: 'Ashfen burns its dead on the water. You learned to move quietly between the reeds.' },
  { id: 'ironreach', name: 'Ironreach', color: '#9aa7b8', tag: 'Deep mines', perk: 'Deep-lunged', desc: '+30 max health',
    mods: { hp: 30 }, fog: 0x10131a,
    line: 'Ironreach digs the Capital\'s iron and buries the diggers. You are not easy to bury.' },
  { id: 'cinderhold', name: 'Cinderhold', color: '#e0793a', tag: 'Furnaces & forges', perk: 'Furnace-fire', desc: 'Arrows set the risen alight',
    mods: { burn: true }, fog: 0x1a0f0a,
    line: 'Cinderhold keeps the Capital warm. Your hands still smell of smoke.' },
  { id: 'greywater', name: 'Greywater', color: '#6fa3c9', tag: 'Fishing villages', perk: 'Steady hands', desc: 'Fire 25% faster',
    mods: { draw: 0.75 }, fog: 0x0b1620,
    line: 'Greywater feeds the Capital and goes hungry. A hundred nets taught you patience.' },
  { id: 'bramblewood', name: 'Bramblewood', color: '#8dbf5a', tag: 'Forests & herbalists', perk: 'Forager', desc: 'Start with 3 draughts, heal 50% more',
    mods: { pots: 3, heal: 1.5 }, fog: 0x0c170c,
    line: 'Bramblewood grows what the Capital eats. You know which roots heal and which kill.' },
  { id: 'saltmarrow', name: 'Saltmarrow', color: '#d9c89a', tag: 'Salt flats & ports', perk: 'Tidewalker', desc: 'Longer roll, cheaper stamina',
    mods: { roll: 1.35 }, fog: 0x1a1812,
    line: 'Saltmarrow ships the Capital\'s cargo. You have dodged worse than the risen.' },
  { id: 'stonebarrow', name: 'Stonebarrow', color: '#c46a6a', tag: 'Quarries', perk: 'Quarryman\'s arm', desc: '+20% arrow damage',
    mods: { dmg: 1.2 }, fog: 0x1a0d0f,
    line: 'Stonebarrow cut the Capital\'s walls. Every stone you lifted made you stronger.' },
  { id: 'highmoor', name: 'Highmoor', color: '#b49be0', tag: 'Moors & shepherds', perk: 'Full quiver', desc: '+40% arrow capacity',
    mods: { ammo: 1.4 }, fog: 0x120f1a,
    line: 'Highmoor herds the Capital\'s flocks across empty hills. You can count on a long shot.' },
];

// Four tributes per region draw from these looks — body, skin and clothes tint.
export const TRIBUTES = [
  { id: 'wren',  name: 'Wren',  skin: '#e7c1a2', cloth: '#3a4a3a', hair: '#2a1d14', blurb: 'Quick, wary, quiet. Wren trusts her ears before her eyes.' },
  { id: 'sable', name: 'Sable', skin: '#6e4730', cloth: '#4a2a36', hair: '#0e0a08', blurb: 'Sable\'s family disappeared into a previous Games. Hers will not.' },
  { id: 'ember', name: 'Ember', skin: '#f0d3b8', cloth: '#7a3a20', hair: '#7a2a14', blurb: 'Loud in the daylight, silent in the dark. A survivor of three winters.' },
  { id: 'ash',   name: 'Ash',   skin: '#b88a64', cloth: '#2f3d52', hair: '#d8d2c4', blurb: 'Ash has already seen the Capital\'s secrets — and kept them.' },
];

export const RIVAL_NAMES = ['Corvin', 'Maren', 'Teague', 'Ilse', 'Dov', 'Pell', 'Rook', 'Sunniva', 'Brannoc', 'Yara', 'Hollis', 'Tamsin'];

export const PROLOGUE = [
  'Every year the Leaders of the Capital choose tributes from the eight regions.',
  'They send them into the Hollow — a cursed arena of graveyards and risen dead — and watch them kill each other for sport.',
  'This year, you were chosen.',
];

// Chapters. `markers` is where the objective points in world space (negative z is forward).
export const CHAPTERS = {
  1: { name: 'The Reaping', place: 'Hollow Lane',
    intro: ['The gate closes behind you. Somewhere above, the Capital\'s cameras are already watching.',
            'Hollow Lane. The first stretch of the arena — and the first dead to wake.'] },
  2: { name: 'The Old Cemetery', place: 'Old Cemetery',
    intro: ['Past the gate, the lane gives way to graves — thousands of them, all freshly turned.',
            'The Gamemakers\' Abbess waits among the stones. Light the three braziers and she will have to show herself.'] },
  3: { name: 'The Hollow Heart', place: 'Hollow Heart',
    intro: ['The heart of the arena. Other tributes — from other regions — have made it here too.',
            'You do not have to kill them. The Games only work if you do.'] },
  4: { name: 'The Capital', place: 'The Capital',
    intro: ['The train does not stop for celebration. It carries you straight to the Capital.',
            'The colosseum rises above you. Tens of thousands of voices. The Leaders\' box is empty — for now.',
            'You are not here to win. You are here to end it.'] },
};

export const ENDINGS = {
  alone: ['A Lone Victor', 'The broadcast is silenced and the Leaders flee, but you stand in the empty colosseum alone. The Games are over — yet nobody came to cheer. The regions are free, and the quiet is heavy.'],
  some: ['A Fragile Peace', 'The broadcast is silenced. Those you spared stand with you as the regions rise. It will take years to rebuild — but nobody will ever be sent into the Hollow again.'],
  many: ['The Regions Rise', 'The beacons fall, and with them the Leaders\' hold. Every tribute you spared fights beside you as the eight regions march on the Capital. The Hollow Games are finished — for good.'],
};

export const LORE = {
  abbess: 'The Abbess was the Gamemakers\' voice in the dark, whispering the risen awake.',
  stonehorn: 'The Stonehorn — the arena\'s last trick. The Gamemakers released it when the tributes would not fight.',
};

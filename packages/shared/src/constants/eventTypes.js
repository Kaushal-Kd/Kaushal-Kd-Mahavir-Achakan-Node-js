/**
 * Wedding event types (requirements §94.1).
 * Stored on orders.event_type (JSON array to support multi-event weddings).
 */
export const EVENT_TYPES = Object.freeze({
  ENGAGEMENT: 'engagement',
  HALDI: 'haldi',
  MEHENDI: 'mehendi',
  SANGEET: 'sangeet',
  WEDDING: 'wedding',
  RECEPTION: 'reception',
  MAMERU: 'mameru',
  PITHI: 'pithi',
  RING_CEREMONY: 'ring_ceremony',
  PRE_WEDDING_SHOOT: 'pre_wedding_shoot',
  ANNIVERSARY: 'anniversary',
  MUHURAT: 'muhurat',
  OTHER: 'other',
});

export const EVENT_TYPE_LABELS = Object.freeze({
  engagement: 'Engagement / Sagai',
  haldi: 'Haldi',
  mehendi: 'Mehendi',
  sangeet: 'Sangeet',
  wedding: 'Wedding / Shaadi',
  reception: 'Reception',
  mameru: 'Mameru / Mahera',
  pithi: 'Pithi',
  ring_ceremony: 'Ring Ceremony',
  pre_wedding_shoot: 'Pre-wedding Shoot',
  anniversary: 'Anniversary',
  muhurat: 'Muhurat / Tilak',
  other: 'Other',
});

/**
 * Wearer roles for wedding orders (requirements §94.2).
 * Stored per order_item so each outfit knows who it is for.
 */
export const WEARER_ROLES = Object.freeze({
  GROOM: 'groom',
  BRIDE: 'bride',
  GROOM_FATHER: 'groom_father',
  GROOM_BROTHER: 'groom_brother',
  GROOM_FAMILY: 'groom_family',
  BRIDE_FATHER: 'bride_father',
  BRIDE_BROTHER: 'bride_brother',
  BRIDE_FAMILY: 'bride_family',
  BARAAT: 'baraat',
  RING_BEARER: 'ring_bearer',
  PAGE_BOY: 'page_boy',
  BEST_MAN: 'best_man',
  PANDIT: 'pandit',
  GUEST: 'guest',
  OTHER: 'other',
});

export const WEARER_ROLE_LABELS = Object.freeze({
  groom: 'Groom',
  bride: 'Bride',
  groom_father: "Groom's Father",
  groom_brother: "Groom's Brother",
  groom_family: "Groom's Family",
  bride_father: "Bride's Father",
  bride_brother: "Bride's Brother",
  bride_family: "Bride's Family",
  baraat: 'Baraat / Friends',
  ring_bearer: 'Ring Bearer',
  page_boy: 'Page Boy / Flower Girl',
  best_man: 'Best Man',
  pandit: 'Pandit',
  guest: 'Guest',
  other: 'Other',
});

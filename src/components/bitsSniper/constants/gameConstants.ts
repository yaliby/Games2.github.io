/**
 * Bits Sniper – game constants (player, bot, physics, UI, debug).
 * Single source for numeric and config values used across the game.
 */

export const DEBUG_MINIMAP_POSITION = false;
/** מצב דיבאג: מציג את ה־Box3 של הקולידרים (קירות/רצפה). */
export const DEBUG_COLLIDERS = false;

export const MINIMAP_ZOOM = 1;
export const MINIMAP_SIZE = 200;

export const PLAYER_HEIGHT = 1.65;
export const PLAYER_SPAWN_LIFT = 0.9;
export const PLAYER_RADIUS = 0.38;

export const MOVE_SPEED = 9.2;
export const RUN_MULT = 1.70;
export const JUMP_VEL = 8.8;
export const GRAVITY = 22;
export const CROUCH_MOVE_MULT = 0.58;
export const CROUCH_CAMERA_DROP = 0.38;
export const SLIDE_DURATION_SECS = 0.72;
export const SLIDE_COOLDOWN_SECS = 1.2;
export const SLIDE_SPEED_MULT = 2.05;
export const LANDING_KICK_MULT = 0.018;
export const LOOK_SENS_BASE = 0.0022;

export const VCURSOR_SENS = 1.0;

export const BOT_COUNT = 1;
export const BOT_RADIUS = 0.50;
export const BOT_HEIGHT = 0.95;
export const BOT_EGG_R = 0.62;
export const RESPAWN_SECS = 3.5;
export const SPAWN_INVINCIBLE = 1.5;
export const MAX_HEALTH = 100;
export const BOT_MAX_HEALTH = 80;

export const LOOK_SENS_MIN = 0.0012;
export const LOOK_SENS_MAX = 0.0035;
export const LOOK_SENS_STEP = 0.0002;
export const ADS_SENS_MIN = 0.4;
export const ADS_SENS_MAX = 1.6;
export const ADS_SENS_STEP = 0.05;
export const MASTER_VOL_MIN = 0;
export const MASTER_VOL_MAX = 1;
export const MASTER_VOL_STEP = 0.05;
export const BG_MUSIC_MAX_GAIN = 0.14;

export const ADS_LOOK_SENS_MULT = 0.56;
export const ADS_MOVE_MULT = 0.76;
export const ADS_SPREAD_MULT = 0.52;
export const HIP_SPREAD_MULT = 1.38;

export const GROUND_ACCEL = 19;
export const AIR_ACCEL = 4.2;
export const GROUND_BRAKE = 15.5;
export const AIR_BRAKE = 2.8;
export const AIR_DRAG = 2.0;
export const COYOTE_TIME_SECS = 0.12;
export const JUMP_BUFFER_SECS = 0.11;
export const JUMP_RELEASE_CUT = 0.56;

export const PROJECTILE_SPEED_MULT = 5.8;
export const SHOT_SPREAD_MULT = 0.62;
export const BOT_INACCURACY = 0.045;
export const RECOIL_RESET_SECS = 0.32;

export const BOT_ACCEL = 14;
export const BOT_BRAKE = 12;
export const BOT_SPEED_WALK = 2.8;
export const BOT_SPEED_RUN = 5.8;
export const BOT_YAW_LERP = 6.5;
export const BOT_MODEL_FACING_OFFSET = 0;

export const HP_REGEN_DELAY_SECS = 3.0;
export const HP_REGEN_EXP_RATE = 0.05;
export const LOW_HP_WARN_THRESHOLD = 34;

export const POSTFX_BLOOM_STRENGTH = 0.78;
export const POSTFX_BLOOM_RADIUS = 0.5;
export const POSTFX_BLOOM_THRESHOLD = 0.65;
export const POSTFX_EXPOSURE = 1.24;

export const MATCH_DURATION_SECS = 180;
export const KILL_FEED_TTL_SECS = 4.2;
export const HEADSHOT_MULT = 1.65;
export const BOT_HEAD_Y_OFFSET = 0.95 * 0.34; // BOT_HEIGHT * 0.34

export const FLAT_SPAWN_HALF = 46;
export const STAGE_ASPECT = 16 / 9;
export const STAGE_PRESET_WIDTHS = {
  small: 760,
  medium: 980,
  large: 1220,
} as const;
export const SHELL_PADDING_PX = 30;

export const DEG2RAD = Math.PI / 180;

export type SpawnZone = [number, number, number, number];

/** Competitive symmetric spawns: each side has a protected exit + risky fast exit. */
export const PLAYER_SPAWN_ZONES: SpawnZone[] = [
  [-64, 52, 12, 12],
  [-58, 40, 12, 12],
  [-44, 52, 12, 10],
];

export const BOT_SPAWN_ZONES: SpawnZone[] = [
  [52, -64, 12, 12],
  [40, -58, 12, 12],
  [-12, -40, 24, 20],
  [-18, -10, 12, 20],
  [6, -10, 12, 20],
  [-12, 26, 24, 18],
];

export const BOT_NAMES = [
  "KoloBot", "YoloEgg", "SnipeHen", "CrackBot", "FryBot", "Scrambles", "Clucky",
];

export const BOT_COLORS_HEX = [
  "#e84a4a", "#e87a40", "#e8c44a", "#40e880", "#40b0e8", "#a040e8", "#e840b0",
];

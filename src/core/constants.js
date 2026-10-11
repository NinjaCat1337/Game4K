/** Board side length in cells. */
export const SIZE = 8;

/** Number of cells on the board (SIZE × SIZE). */
export const CELLS = 64;

/** Pieces per tray. */
export const HAND_SIZE = 3;

/** Block color ids are 1..COLOR_COUNT; 0 means an empty cell. */
export const COLOR_COUNT = 7;

/** The 3rd consecutive non-clearing placement breaks the combo streak. */
export const COMBO_MISS_LIMIT = 3;

/** Research found no confirmed all-clear bonus (celebration only). */
export const ALL_CLEAR_BONUS = 0;

/** Version tag written by Game#toJSON() and required by Game.fromJSON(). */
export const SAVE_VERSION = 1;

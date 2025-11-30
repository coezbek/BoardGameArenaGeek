# BoardGameArenaGeek

Tampermonkey Userscript that fetches BoardGameGeek.com (BGG) stats and displays them directly on BoardGameArena.com (BGA).

It adds a badge under each game card showing:
*   BGG Score
*   Rank
*   Complexity (Weight)
*   Best Player Count (based on community polls)

Clicking the badge opens the game's page on BGG.

## Screenshots

Works on each game's main page:

<img width="1110" height="335" alt="image" src="https://github.com/user-attachments/assets/2687e3d4-a63f-4d26-9e86-833d37ec0a49" />

And on the gamelist [https://boardgamearena.com/gamelist](https://boardgamearena.com/gamelist)

<img width="972" height="477" alt="image" src="https://github.com/user-attachments/assets/6b660485-15f1-4f1a-b603-8bba51f22192" />

## Installation

1.  Install [Tampermonkey](https://www.tampermonkey.net/) extension for your browser, e.g. [for Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo?hl=en)
2.  **[Click here to install the script](https://raw.githubusercontent.com/coezbek/BoardGameArenaGeek/main/BoardGameArenaGeek.user.js)**.

## How it works

The script scans the BGA gamelist and game panel pages. It attempts to match the BGA game name with a BGG ID.

*   **Queue System:** The script processes one game every 5 seconds. A status panel in the bottom left shows the queue progress.
*   **Caching:** Mappings between BGA names and BGG IDs and scores are cached.

## Controls

A small panel is added to the bottom left of the screen:

*   **Reset IDs:** Clears the name-to-ID mapping. Use this if a game is linked to the wrong BGG page.
*   **Reset Scores:** Clears the stats cache. Use this to update ratings.
*   **Force Rescan:** useful if infinite scroll loaded new games but the script didn't pick them up.

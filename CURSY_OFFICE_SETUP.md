# Cursy's Office Setup Guide

## Asset Structure

The code is now set up to use isometric assets from the "Essential Isometric Living Room and HomeOffice" pack. Here's how to organize the assets:

## Folder Structure

```
src/renderer/assets/cursy-office/
├── characters/          # Character sprites (dad/mom)
│   ├── dad_computer_idle_01.png
│   ├── dad_computer_idle_02.png
│   ├── dad_computer_idle_03.png
│   ├── dad_computer_working_01.png
│   ├── dad_computer_working_02.png
│   └── dad_computer_working_03.png
├── room/               # Room tiles (walls, floors)
│   ├── lvngroom_floor02_01.png
│   ├── lvngroom_wall01_COL02.png
│   └── ... (other wall/floor tiles)
├── furniture/          # Furniture items
│   ├── hmoff_computer_set01COL.png
│   ├── hmoff_officedesk01mid_back.png
│   └── ... (other furniture)
└── props/              # Decorative items
    ├── plant01.png
    ├── assortedposters01.png
    └── ... (other props)
```

## Copying Assets

1. **Character Assets** (from the "dad" character folder):
   - Copy the computer desk idle frames → `characters/dad_computer_idle_*.png`
   - Copy the computer desk working frames → `characters/dad_computer_working_*.png`
   - Use the **combined** desk/chair versions for convenience

2. **Room Tiles** (from the "Living Room" folder):
   - Copy floor tiles → `room/lvngroom_floor*.png`
   - Copy wall corner pieces → `room/lvngroom_wall01_COL*.png`
   - Copy wall segments → `room/lvngroom_wall01_sngl*.png`

3. **Furniture** (from the "Home Office" folder):
   - Copy computer setup (combined) → `furniture/hmoff_computer_set01COL.png`
   - Copy desk variations → `furniture/hmoff_officedesk*.png`
   - Copy chairs → `furniture/hmoff_officeChair*.png`

4. **Props** (from various folders):
   - Copy plants → `props/plant*.png`
   - Copy posters → `props/assortedposters*.png`
   - Copy frames → `props/caretakerframe*.png`
   - Copy notes → `props/pinnednote*.png`

## Current Implementation

The code currently expects:
- **Character**: `dad_computer_idle_01.png`, `dad_computer_idle_02.png`, etc.
- **Room**: `lvngroom_floor02_01.png` (floor), `lvngroom_wall01_COL02.png` (corner)
- **Furniture**: `hmoff_computer_set01COL.png` (desk with computer)
- **Props**: `plant01.png`, `assortedposters01.png`

## Animation States

- **idle**: Cycles through `dad_computer_idle_*.png` frames (2 fps)
- **thinking**: Slower idle animation (1 fps)
- **typing**: Cycles through `dad_computer_working_*.png` frames (4 fps)
- **celebrating**: Fast idle animation (6 fps)

## Next Steps

1. Copy the assets to the folders above
2. Update frame paths in `renderer.js` if your file names differ
3. Adjust positioning in `buildCursyOffice()` function as needed
4. Test the visualization by toggling it in the chat sidebar

## Notes

- The code includes fallback handling if images don't exist (shows colored divs)
- Character animations cycle through frames automatically
- Props have hover effects (brightness + slight lift)
- All images use pixel-perfect rendering for crisp isometric look


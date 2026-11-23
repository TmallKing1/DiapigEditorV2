-- GradientPrimitives: format 2 pure-data delivery fixture, not a mounted game script.
-- Seven integers per record: kind,cx,cy,w,h,ccw_degrees,0xAARRGGBB.
-- Bottom-left origin; kind 4 = 106057 Basic, 5 = 106093 Stretch, 6 = 106091 Stretch.
-- Covers all hard/soft kinds, rotation, tint, AA=255/128/64 and four-edge clipping.
-- Probe assets: observed/passed on PC CN 7.2.0.49085326.
-- This composed art and the new art engine: inferred desktop checks; engine verification pending.
return {
    format=2,w=320,h=240,bg=0x1C222E,
    shapes={
        -- Hard rectangle, ellipse and upward triangle (bottom row).
        1,48,32,76,24,0,0x80F8B56A,
        2,160,32,72,28,30,0x8085E3CE,
        3,270,32,38,34,45,0xFFDBB7FF,
        -- Non-uniform radial, diagonal one-sided fade, diagonal symmetric band.
        4,70,158,112,56,30,0xFFFF785C,
        5,198,166,100,46,45,0x8069CFFF,
        6,258,92,104,28,45,0x40FFE4A3,
        -- Radial alpha comparison on the same background.
        4,60,88,48,48,0,0x80FF785C,
        4,120,88,48,48,0,0x40FF785C,
        -- Directional linear: 90 degrees fades upward, 180 left, 270 downward.
        5,170,102,72,24,90,0xFF80E5BC,
        5,236,200,96,24,180,0x40E6C5FF,
        5,296,150,80,20,270,0x80FFE4A3,
        -- Left/right/top/bottom overflow: the outer 100001 mask must clip it all.
        4,0,130,100,56,30,0x80FF6EA8,
        5,320,36,96,30,180,0x8069CFFF,
        6,160,240,140,36,45,0x80FFE4A3,
        1,160,0,110,24,0,0x8085E3CE,
    },
}

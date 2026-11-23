-- TransparentPrimitives: format 3 pure-data example; no game script mapping is created.
-- Background RGB/Alpha are zero; shape colors are straight (not premultiplied) AARRGGBB.
-- Seven integers per record: kind,cx,cy,w,h,ccw_degrees,color; bottom-left origin.
-- One transparent 100001 parent mask clips every child; no per-shape masks.
-- Alpha-zero parent clipping is observed; full format 3 engine verification is pending.
return {
    format=3,w=320,h=240,bg=0,bgAlpha=0,
    shapes={
        -- White rectangle, colored ellipse and triangle; overlap accumulates Alpha.
        1,56,48,96,40,0,0x80FFFFFF,
        2,98,54,76,52,30,0x8069CFFF,
        3,238,50,68,60,0,0xFFFFB56A,
        -- Radial white, colored one-sided fade and symmetric band; top/right clipping.
        4,72,168,112,80,30,0xC0FFFFFF,
        5,198,208,120,64,90,0x8085E3CE,
        6,306,144,100,36,45,0x80DBB7FF,
    },
}

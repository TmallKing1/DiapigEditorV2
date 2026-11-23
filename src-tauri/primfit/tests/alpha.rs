//! Transparent-mode checks use a direct premultiplied RGBA renderer as oracle.
use primfit::{coverage_row, rasterize, run_fit, run_refine, Budget, FitOptions, Fitter, Rng, Shape};
use std::sync::atomic::{AtomicUsize, Ordering};
const W: usize = 24;
const H: usize = 20;
const QUICK: Budget = Budget { candidates: 30, restarts: 1, age: 16 };
fn shape(k:u8, a:i32, c:u32)->Shape { Shape{k,x:12,y:10,w:18,h:14,r:37,a,c,delta:0.0} }
fn render(shapes:&[Shape])->Vec<[f64;4]> {
    let mut out=vec![[0.0;4];W*H];
    let mut lines=vec![0;H*3];
    for s in shapes {
        let rows=rasterize(s,W,H,&mut lines);
        let color=[((s.c>>16)&255) as f64,((s.c>>8)&255) as f64,(s.c&255) as f64,255.0];
        for l in lines[..rows*3].chunks_exact(3) {
            for(p,m) in coverage_row(s,l[0] as usize,l[1] as usize,l[2] as usize,W) {
                let a=s.a as f64/255.0*m;
                for c in 0..4 { out[p][c] += a*(color[c]-out[p][c]); }
            }
        }
    }
    out
}
fn error(pixels:&[[f64;4]],data:&[u8],alpha:&[u8])->f64 {
    pixels.iter().enumerate().map(|(i,p)| {
        (0..3).map(|c|(p[c]-data[i*3+c] as f64).powi(2)).sum::<f64>()+(p[3]-alpha[i] as f64).powi(2)
    }).sum()
}
fn close(a:f64,b:f64) { assert!((a-b).abs()<1e-7*a.abs().max(b.abs()).max(1.0),"{a} != {b}"); }
fn target()->(Vec<u8>,Vec<u8>) {
    let mut rng=Rng::new(27);
    let alpha:Vec<u8>=(0..W*H).map(|_|rng.int(256) as u8).collect();
    let data=alpha.iter().flat_map(|a|(0..3).map(|_|rng.int(*a as usize+1) as u8).collect::<Vec<_>>()).collect();
    (data,alpha)
}
#[test]
fn transparent_score_matches_direct_rgba_and_brute_force_color() {
    let (data,alpha)=target();
    let mut f=Fitter::new_alpha(data.clone(),W,H,alpha.clone(),&FitOptions::default());
    let mut history=vec![shape(4,110,0xFF2030),shape(3,255,0x2030FF)];
    for s in &history { f.add(s); }
    let before=error(&render(&history),&data,&alpha);
    close(f.error(),before);
    for k in 1..=6 {
        for a in [1,64,128,255] {
            let mut s=shape(k,a,0);
            if a==64 { s.x=1; s.y=2; s.w=31; s.r=91; }
            let delta=f.evaluate(&mut s,&mut f.scratch());
            history.push(s);
            let expected=error(&render(&history),&data,&alpha)-before;
            close(delta,expected);
            for channel in 0..3 {
                for value in 0..=255u32 {
                    let mask=0xFFu32 << (16-channel*8);
                    let mut candidate=s;
                    candidate.c=(s.c&!mask)|(value<<(16-channel*8));
                    *history.last_mut().unwrap()=candidate;
                    let e=error(&render(&history),&data,&alpha)-before;
                    assert!(e+1e-6>=expected,"k={k} a={a} channel={channel} value={value}");
                }
            }
            history.pop();
        }
    }
}
#[test]
fn alpha_is_scored_even_for_black_and_empty_targets() {
    let data=vec![0;W*H*3];
    let mut f=Fitter::new_alpha(data.clone(),W,H,vec![128;W*H],&FitOptions::default());
    assert_eq!(f.bg_alpha(),0);
    let mut s=shape(1,128,0);
    let before=f.error();
    let d=f.evaluate(&mut s,&mut f.scratch());
    assert_eq!(s.c,0);
    assert!(d<0.0);
    f.add(&s);close(before+d,f.error());
    let mut empty=Fitter::new_alpha(data,W,H,vec![0;W*H],&FitOptions::default());
    assert_eq!(empty.rmse(),0.0);
    assert!(run_fit(&mut empty,10,QUICK,1,2,|_,_,_|panic!("transparent image needs no shapes"),||false).is_empty());
    assert_eq!(empty.bg(),0);
    assert_eq!(empty.bg_alpha(),0);
}
#[test]
fn transparent_refinement_prefix_replay_and_stop_agree() {
    let truth=vec![shape(4,90,0xFA2030),shape(5,64,0x3080FF),shape(2,255,0x009010)];
    let pixels=render(&truth);
    let data:Vec<u8>=pixels.iter().flat_map(|p|p[..3].iter().map(|v|v.round() as u8)).collect();
    let alpha:Vec<u8>=pixels.iter().map(|p|p[3].round() as u8).collect();
    for fixed in [0,64,255] {
        let opts=FitOptions{kinds:vec![1,2,3,4,5,6],alpha:fixed,guided:1.0,..FitOptions::default()};
        let mut f=Fitter::new_alpha(data.clone(),W,H,alpha.clone(),&opts);
        let mut shapes=run_fit(&mut f,35,QUICK,42,2,|_,_,_|{},||false);
        assert!(!shapes.is_empty());
        let before=f.error();
        let processed=AtomicUsize::new(0);
        run_refine(&mut f,&mut shapes,2,QUICK,42,2,|_,n|{processed.store(n,Ordering::Relaxed);},||processed.load(Ordering::Relaxed)>=8);
        assert!(f.error()<=before+1e-6);
        close(f.error(),error(&render(&shapes),&data,&alpha));
        let partial=f.error();
        run_refine(&mut f,&mut shapes,2,QUICK,13,2,|_,_|{},||false);
        assert!(f.error()<=partial+1e-6);
        close(f.error(),error(&render(&shapes),&data,&alpha));
        close(*f.prefix_rmse(&shapes).last().unwrap(),f.rmse());
        assert_eq!(f.bg(),0);assert_eq!(f.bg_alpha(),0);
        if fixed>0 { assert!(shapes.iter().all(|s|s.a==fixed)); }
    }
}

#[test]
fn hundreds_of_translucent_layers_do_not_underflow_refinement_state() {
    let mut shapes: Vec<Shape> = (0..600).map(|i|shape(4,254,if i%2==0 {0xFF4020} else {0x2080FF})).collect();
    shapes.push(shape(3,255,0xFFFFFF));
    let pixels=render(&shapes);
    let data:Vec<u8>=pixels.iter().flat_map(|p|p[..3].iter().map(|v|v.round() as u8)).collect();
    let alpha:Vec<u8>=pixels.iter().map(|p|p[3].round() as u8).collect();
    let mut f=Fitter::new_alpha(data.clone(),W,H,alpha.clone(),&FitOptions::default());
    for s in &shapes { f.add(s); }
    let before=f.error();
    run_refine(&mut f,&mut shapes,1,Budget{age:0,..QUICK},1,2,|_,_|{},||false);
    assert!(f.error().is_finite() && f.error()<=before+1e-6);
    close(f.error(),error(&render(&shapes),&data,&alpha));
}

const video=document.getElementById('club-intro');
if(video){
  const figure=video.closest('.hero-intro');
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  let visible=true;
  const sync=()=>figure.classList.toggle('is-playing',!video.paused);
  const play=async()=>{
    if(!visible||document.hidden||motion.matches||navigator.connection?.saveData)return;
    video.muted=true;
    if(!video.getAttribute('src'))video.src=video.dataset.src;
    try{await video.play();}catch{sync();}
  };
  video.addEventListener('playing',()=>{figure.classList.add('has-frame');sync();});
  video.addEventListener('pause',sync);video.addEventListener('error',()=>{figure.classList.remove('has-frame');sync();});
  new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;if(visible)void play();else video.pause();},{threshold:.05}).observe(figure);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)video.pause();else void play();});
  motion.addEventListener('change',()=>{if(motion.matches){video.pause();figure.classList.remove('has-frame');}else void play();});
}

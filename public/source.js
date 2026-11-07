const form=document.querySelector('#source-form'),ready=document.querySelector('#source-ready'),status=document.querySelector('#source-status');
const show=()=>{form.hidden=true;ready.hidden=false;};
form.addEventListener('submit',async event=>{
 event.preventDefault();const button=form.querySelector('button');button.disabled=true;status.textContent='Проверяем доступ…';
 try{const response=await fetch('/api/source/login',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.querySelector('#source-password').value})});const data=await response.json();if(!response.ok)throw Error(data.error?.message||'Не удалось проверить пароль.');form.reset();show();status.textContent='';}
 catch(error){status.textContent=error.message||'Нет связи с сервером.';}finally{button.disabled=false;}
});
fetch('/api/source/session',{credentials:'same-origin',cache:'no-store'}).then(r=>r.json()).then(d=>{if(d.authenticated)show();}).catch(()=>{});

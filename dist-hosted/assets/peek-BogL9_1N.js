import{O as n,B as c}from"./shared-BbRyBCYS.js";import{C as l,b as m}from"./peek-card-BTqQwlzp.js";import{a as d}from"./theme-Dy11vvQG.js";const i="status-peek-peek-style",u=`
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0; overflow: hidden;
  width: 100%; height: 100%;
  /* 兜底底色：主题变量未就绪时至少是浅色，不至于透明露画布 */
  background: #fff;
}
/* scope 类挂在 body 上，承接 CARD_CSS（与 background 的离屏测量容器同名同规则） */
body { display: flex; align-items: flex-start; }
#root { width: 100%; }
${l}
`;function h(){if(document.body.classList.add("spp-peek-scope"),document.getElementById(i))return;const e=document.createElement("style");e.id=i,e.textContent=u,document.head.appendChild(e)}h();function p(){const e=location.hash.replace(/^#/,"");if(!e)return null;try{const t=JSON.parse(decodeURIComponent(e));return typeof t!="object"||t===null?null:t}catch{return null}}function f(e){const t=document.getElementById("root");if(!t)return;t.innerHTML="";const o=m(e);t.appendChild(o);function r(){const s=Math.ceil(o.getBoundingClientRect().height)+1;try{n.broadcast.sendMessage(c,{height:s},{destination:"LOCAL"})}catch{}}requestAnimationFrame(r),setTimeout(r,120)}const a=p();n.onReady(()=>{n.theme.getTheme().then(d),n.theme.onChange(d)});if(a)f(a);else{const e=document.getElementById("root");e&&(e.innerHTML="")}

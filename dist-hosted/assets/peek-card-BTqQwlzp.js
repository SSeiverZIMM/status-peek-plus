const b=320;function n(e,t,p){const i=document.createElement(e);return t&&(i.className=t),p!==void 0&&(i.textContent=p),i}function g(e,t){const p=document.createDocumentFragment();if(!Array.isArray(e)||e.length===0)return p.appendChild(n("p","body",t)),p;for(const i of e){if(typeof i!="object"||i===null)continue;if("text"in i&&typeof i.text=="string"){p.appendChild(c(i));continue}if(!("type"in i)||!("children"in i))continue;const r=i,o=Array.isArray(r.children)?r.children:[];switch(r.type){case"heading-one":p.appendChild(n("h1","h",l(o)));break;case"heading-two":p.appendChild(n("h2","h",l(o)));break;case"paragraph":{const d=n("p","body");for(const s of o)d.appendChild(c(s));p.appendChild(d);break}case"bulleted-list":case"numbered-list":{const d=n(r.type==="numbered-list"?"ol":"ul");for(const s of o){const a=n("li");if(s&&typeof s=="object"&&"children"in s){const f=s.children;for(const u of Array.isArray(f)?f:[])a.appendChild(c(u))}d.appendChild(a)}p.appendChild(d);break}default:p.appendChild(n("p","body",l(o)))}}return p}function c(e){const t=document.createDocumentFragment();if(typeof e=="string")return t.appendChild(document.createTextNode(e)),t;if(typeof e!="object"||e===null)return t;const p=e;if(typeof p.text!="string")return t;let i=document.createTextNode(p.text);const r=o=>{const d=document.createDocumentFragment(),s=document.createElement(o);return s.appendChild(i),d.appendChild(s),d};return p.bold===!0&&(i=r("b")),p.italic===!0&&(i=r("i")),p.underline===!0&&(i=r("u")),t.appendChild(i),t}function l(e){let t="";for(const p of e)typeof(p==null?void 0:p.text)=="string"&&(t+=p.text);return t}const h=/^#[0-9a-f]{6}$/i;function x(e){const t=n("div","foot");return e.expired?t.appendChild(n("span","pill expired-pill","已结束")):e.rounds<=0?t.appendChild(n("span","pill muted","持续：不限")):e.remaining===null?t.appendChild(n("span","pill muted",`持续：${e.rounds} 轮（未倒数）`)):e.remaining>0?t.appendChild(n("span","pill",`剩 ${e.remaining} / ${e.rounds} 轮`)):t.appendChild(n("span","pill expired-pill","本轮到期")),t}function m(e){const t=n("div",`card${e.expired?" expired":""}`),p=n("div","bar");p.style.background=h.test(e.color)?e.color:"#888780",t.appendChild(p);const i=n("div","body-wrap");if(e.name){const o=n("div","title",e.name);o.style.color=h.test(e.color)?e.color:"",i.appendChild(o)}const r=n("div","desc");return r.appendChild(g(e.desc,e.descPlain)),i.appendChild(r),i.appendChild(x(e)),t.appendChild(i),t}const k=`
.spp-peek-scope {
  margin: 0; padding: 0; overflow: hidden;
  width: 100%; height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 14px; line-height: 1.6;
}
.spp-peek-scope .card {
  width: 100%;
  display: flex; align-items: stretch;
  background: var(--spp-surface, #fff);
  border: 1px solid var(--spp-line, rgba(0,0,0,0.15));
  border-radius: 12px;
  overflow: hidden;
}
.spp-peek-scope .card.expired { opacity: 0.72; }
.spp-peek-scope .bar { width: 4px; flex: 0 0 4px; }
.spp-peek-scope .body-wrap { flex: 1; min-width: 0; padding: 10px 14px 10px 12px; }
.spp-peek-scope .title {
  font-size: 15px; font-weight: 500; line-height: 1.4;
  margin-bottom: 6px; word-break: break-word;
}
.spp-peek-scope .h {
  font-size: 14px; font-weight: 500; margin: 8px 0 4px; line-height: 1.4;
}
.spp-peek-scope .h:first-child { margin-top: 0; }
.spp-peek-scope .desc {
  font-size: 13px; line-height: 1.6;
  color: var(--spp-text-2, #444441); word-break: break-word;
}
.spp-peek-scope .desc p { margin: 0 0 6px; }
.spp-peek-scope .desc p:last-child { margin-bottom: 0; }
.spp-peek-scope .desc ul, .spp-peek-scope .desc ol { margin: 4px 0 6px; padding-left: 18px; }
.spp-peek-scope .desc li { margin: 2px 0; }
.spp-peek-scope .foot { margin-top: 10px; }
.spp-peek-scope .pill {
  display: inline-block; font-size: 12px; line-height: 1;
  padding: 5px 9px; border-radius: 999px;
  background: var(--spp-wash-2, rgba(0,0,0,0.06)); color: var(--spp-text, #2c2c2a);
}
.spp-peek-scope .pill.muted {
  background: var(--spp-wash-2, rgba(0,0,0,0.04)); color: var(--spp-text-3, #5f5e5a);
}
.spp-peek-scope .pill.expired-pill {
  background: var(--spp-wash-2, rgba(0,0,0,0.05));
  color: var(--spp-text-3, #5f5e5a); text-decoration: line-through;
}
`;export{k as C,b as P,m as b};

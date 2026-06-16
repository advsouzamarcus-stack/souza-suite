const state={token:localStorage.getItem('token'),user:JSON.parse(localStorage.getItem('user')||'null'),current:'dashboard',editing:null};
const $=(id)=>document.getElementById(id);
const labels={clients:'Clientes',cases:'Processos',tasks:'Tarefas',appointments:'Agenda',financial_records:'Financeiro',leads:'Leads',conversations:'Conversas'};
const configs={
 clients:[['name','Nome','text',true],['cpf_cnpj','CPF/CNPJ'],['phone','Telefone'],['email','E-mail'],['address','Endereço'],['source','Origem'],['notes','Observações','textarea']],
 cases:[['process_number','Número do processo','text',true],['tribunal','Tribunal/API DataJud'],['court','Órgão julgador'],['class_name','Classe'],['subject','Assunto'],['phase','Fase'],['status','Status']],
 tasks:[['title','Título','text',true],['description','Descrição','textarea'],['due_at','Prazo','datetime-local'],['status','Status'],['priority','Prioridade']],
 appointments:[['title','Título','text',true],['description','Descrição','textarea'],['starts_at','Início','datetime-local',true],['ends_at','Fim','datetime-local'],['status','Status'],['channel','Canal']],
 financial_records:[['description','Descrição','text',true],['amount','Valor','number',true],['kind','Tipo'],['status','Status'],['due_at','Vencimento','date'],['paid_at','Pagamento','date']],
 leads:[['name','Nome'],['phone','Telefone'],['email','E-mail'],['source','Origem'],['stage','Etapa'],['summary','Resumo','textarea']],
 conversations:[['channel','Canal','text',true],['external_thread_id','ID externo'],['status','Status'],['ai_enabled','IA ativa','checkbox']]
};
async function api(path,opt={}){const headers={'Content-Type':'application/json',...(opt.headers||{})};if(state.token)headers.Authorization='Bearer '+state.token;const r=await fetch('/.netlify/functions/api/'+path,{...opt,headers});const text=await r.text();let data={};try{data=text?JSON.parse(text):{};}catch{data={raw:text};}if(!r.ok)throw new Error(data.error||'Erro na API');return data;}
function setSession(d){state.token=d.token;state.user=d.user;localStorage.setItem('token',d.token);localStorage.setItem('user',JSON.stringify(d.user));}
async function login(){try{loginMsg.textContent='';const d=await api('auth/login',{method:'POST',body:JSON.stringify({email:email.value.trim(),password:password.value})});setSession(d);boot();}catch(e){loginMsg.textContent=e.message;}}
function logout(){localStorage.clear();location.reload();}
function boot(){if(!state.token||!state.user)return;login.classList.add('hidden');app.classList.remove('hidden');view(state.current||'dashboard');}
async function view(v){state.current=v;state.editing=null;title.textContent=labels[v]||'Dashboard';subtitle.textContent=v==='dashboard'?'Visão geral do escritório.':'Dados salvos no Supabase/PostgreSQL.';newBtn.style.display=v==='dashboard'?'none':'inline-block';syncBtn.style.display=v==='cases'?'inline-block':'none';if(v==='dashboard')return dashboard();try{const data=await api(v);renderTable(Array.isArray(data)?data:[data]);}catch(e){grid.innerHTML=`<div class="card"><b>Erro:</b> ${escapeHtml(e.message)}</div>`;}}
async function dashboard(){const names=['clients','cases','tasks','appointments','financial_records','leads','conversations'];const vals=await Promise.all(names.map(n=>api(n).catch(()=>[])));grid.innerHTML='<div class="cards">'+names.map((n,i)=>`<div class="card"><h3>${labels[n]}</h3><strong>${vals[i].length}</strong></div>`).join('')+'</div>';}
function visibleKeys(rows){const hide=['password_hash','datajud_payload','metadata','payload','created_by','updated_at'];return Object.keys(rows[0]||{}).filter(k=>!hide.includes(k)).slice(0,8);}
function renderTable(rows){if(!rows.length){grid.innerHTML='<div class="card">Nenhum registro.</div>';return;}const keys=visibleKeys(rows);grid.innerHTML=`<div class="table-wrap"><table class="table"><thead><tr>${keys.map(k=>`<th>${escapeHtml(k)}</th>`).join('')}<th>Ações</th></tr></thead><tbody>${rows.map(r=>`<tr>${keys.map(k=>`<td>${format(r[k])}</td>`).join('')}<td class="actions"><button onclick='edit(${safeJson(r)})'>Editar</button><button class="danger" onclick="del('${r.id}')">Excluir</button>${state.current==='cases'?`<button class="secondary" onclick="syncOne('${r.id}')">DataJud</button>`:''}</td></tr>`).join('')}</tbody></table></div>`;}
function openNew(){state.editing=null;openForm({});}
function edit(r){state.editing=r;openForm(r);}
function openForm(r){modalTitle.textContent=(state.editing?'Editar ':'Novo ')+(labels[state.current]||state.current);fields.innerHTML=(configs[state.current]||[]).map(([k,l,t='text',req])=>`<div class="field"><label>${l}</label>${field(k,t,r[k],req)}</div>`).join('');modal.showModal();}
function field(k,t,v='',req){const required=req?'required':'';if(t==='textarea')return `<textarea name="${k}" ${required}>${escapeHtml(v||'')}</textarea>`;if(t==='checkbox')return `<select name="${k}"><option value="true" ${v===true?'selected':''}>Sim</option><option value="false" ${v===false?'selected':''}>Não</option></select>`;return `<input name="${k}" type="${t}" value="${escapeHtml(v||'')}" ${required}>`;}
async function saveCurrent(){const data=Object.fromEntries(new FormData(form).entries());for(const k of Object.keys(data)){if(data[k]==='')delete data[k];if(data[k]==='true')data[k]=true;if(data[k]==='false')data[k]=false;}try{if(state.editing)await api(`${state.current}/${state.editing.id}`,{method:'PUT',body:JSON.stringify(data)});else await api(state.current,{method:'POST',body:JSON.stringify(data)});modal.close();view(state.current);}catch(e){alert(e.message);}}
async function del(id){if(!confirm('Excluir registro?'))return;await api(`${state.current}/${id}`,{method:'DELETE'});view(state.current);}
async function syncOne(id){try{await api(`datajud/sync-case/${id}`,{method:'POST'});alert('Processo sincronizado.');view('cases');}catch(e){alert(e.message);}}
async function syncAll(){try{const d=await api('datajud/sync-all',{method:'POST'});alert(`Sincronização concluída: ${d.synced||0} processo(s).`);view('cases');}catch(e){alert(e.message);}}
function format(v){if(v==null)return '';if(typeof v==='boolean')return v?'Sim':'Não';if(typeof v==='object')return '<span class="muted">JSON</span>';return escapeHtml(String(v)).slice(0,180);}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function safeJson(o){return JSON.stringify(o).replace(/</g,'\\u003c').replace(/'/g,'&#39;');}
document.querySelectorAll('aside [data-view]').forEach(b=>b.addEventListener('click',()=>view(b.dataset.view)));
document.querySelector('[data-action="logout"]').addEventListener('click',logout);loginBtn.addEventListener('click',login);newBtn.addEventListener('click',openNew);saveBtn.addEventListener('click',saveCurrent);syncBtn.addEventListener('click',syncAll);password.addEventListener('keydown',e=>{if(e.key==='Enter')login();});
boot();

/* ══════════════════════════════════════════════════════════
   Panel de Operaciones — Warehouse Rentals
   100% conectado a Supabase. No se usa localStorage/sessionStorage.
   ══════════════════════════════════════════════════════════ */

const SUPABASE_URL = 'https://ivpespsvzmutzoxbinjs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2cGVzcHN2em11dHpveGJpbmpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyMTU1NDgsImV4cCI6MjEwMzc5MTU0OH0.pZmgAFFsLlkzZ4TjWkekNtdEeUOZP_pe1jANGPCiUr8';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DB = { ordenes: [], personal: [], unidades: [], venues: [], articulos: [], compras: [], produccion: [], config: {} };
const state = {
  tab: 'ordenes',
  ordenFiltro: 'todos', ordenBusqueda: '',
  semanaOffset: 0,
  calYear: null, calMonth: null, calSelDay: null,
  flotaCalOffset: 0, historialBusqueda: '',
  personalBusqueda: '', venueBusqueda: '', articuloBusqueda: ''
};

/* ───────── helpers de fecha ───────── */
function toDate(s){ if(!s) return null; const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
function isoLocal(d){ const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function addDays(d,n){ const r=new Date(d); r.setDate(r.getDate()+n); return r; }
function addMonths(d,n){ const r=new Date(d); r.setMonth(r.getMonth()+n); return r; }
function fmtDate(s){ if(!s) return '—'; return toDate(s).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'}); }
function fmtDateShort(s){ if(!s) return '—'; return toDate(s).toLocaleDateString('es-MX',{day:'2-digit',month:'short'}); }
function fmtRango(a,b){ if(!a) return '—'; if(!b || b===a) return fmtDate(a); return fmtDateShort(a)+' → '+fmtDate(b); }
function today(){ const t=new Date(); t.setHours(0,0,0,0); return t; }
function startOfWeek(d){ const r=new Date(d); const dow=(r.getDay()+6)%7; r.setDate(r.getDate()-dow); r.setHours(0,0,0,0); return r; }
function ordenTouchesDay(o, isoDay){ const end=o.fecha_fin||o.fecha_inicio; return isoDay>=o.fecha_inicio && isoDay<=end; }
function diasEntre(iniISO, finISO, cap=120){ const out=[]; let cur=toDate(iniISO); const end=toDate(finISO||iniISO); let n=0; while(cur<=end && n<cap){ out.push(isoLocal(cur)); cur=addDays(cur,1); n++; } return out; }
function escapeHtml(s){ return (s??'').toString().replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function slug(txt){ return (txt||'').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,''); }
function badge(txt){ return `<span class="badge badge-${slug(txt)}">${escapeHtml(txt)}</span>`; }

/* ───────── loading / toast ───────── */
function showLoading(on){ document.getElementById('loadingOverlay').classList.toggle('open', on); }
function toast(msg, isErr){ const t=document.getElementById('toast'); t.textContent=msg; t.className='toast'+(isErr?' err':''); requestAnimationFrame(()=>t.classList.add('show')); setTimeout(()=>t.classList.remove('show'),2800); }

/* ───────── tooltip flotante (calendario + gantt de unidades) ───────── */
const hoverTooltipEl = document.getElementById('hoverTooltip');
function showTooltip(target, html){
  hoverTooltipEl.innerHTML = html;
  const rect = target.getBoundingClientRect();
  const ttRect = hoverTooltipEl.getBoundingClientRect();
  let left = rect.left + rect.width/2 - ttRect.width/2;
  left = Math.max(8, Math.min(left, window.innerWidth - ttRect.width - 8));
  let top = rect.top - ttRect.height - 10;
  if(top < 8) top = rect.bottom + 10;
  hoverTooltipEl.style.left = left+'px';
  hoverTooltipEl.style.top = top+'px';
  hoverTooltipEl.classList.add('show');
}
function hideTooltip(){ hoverTooltipEl.classList.remove('show'); }
function ordenTooltipHTML(o){
  const hora = o.hora_inicio ? o.hora_inicio.slice(0,5)+(o.hora_fin?'–'+o.hora_fin.slice(0,5):'') : 'Sin hora definida';
  const asignado = o.orden_personal?.length||0, requerido = o.personal_requerido||0;
  const vehiculos = (o.orden_unidades||[]).map(u=>u.unidad?.tipo).filter(Boolean);
  return `
    <div class="ht-title">${escapeHtml(o.cliente)} — ${escapeHtml(o.nombre_evento)}</div>
    <div class="ht-row">🕒 ${hora}</div>
    <div class="ht-row">📍 ${escapeHtml(o.venue?.nombre||'Sin venue')} · ${o.pax||0} pax</div>
    <div class="ht-row">👥 ${asignado}/${requerido} personal</div>
    <div class="ht-row">🚚 ${vehiculos.length?escapeHtml(vehiculos.join(', ')):'Sin unidad asignada'}</div>
  `;
}
document.getElementById('calGrid').addEventListener('mouseover', e=>{
  const pill = e.target.closest('.cal-pill'); if(!pill) return;
  const o = DB.ordenes.find(x=>x.id===pill.dataset.ordenId); if(!o) return;
  showTooltip(pill, ordenTooltipHTML(o));
});
document.getElementById('calGrid').addEventListener('mouseout', e=>{
  if(e.target.closest('.cal-pill')) hideTooltip();
});
document.getElementById('ganttBody').addEventListener('mouseover', e=>{
  const cell = e.target.closest('.gantt-cell.ocupada'); if(!cell) return;
  const o = DB.ordenes.find(x=>x.id===cell.dataset.ordenId); if(!o) return;
  showTooltip(cell, ordenTooltipHTML(o));
});
document.getElementById('ganttBody').addEventListener('mouseout', e=>{
  if(e.target.closest('.gantt-cell.ocupada')) hideTooltip();
});

/* ───────── carga de datos ───────── */
async function loadAll(){
  showLoading(true);
  try{
    const [ordenesRes, personalRes, unidadesRes, venuesRes, articulosRes, comprasRes, produccionRes, configRes] = await Promise.all([
      sb.from('ordenes').select(`*,
        venue:venues(id,nombre,direccion,capacidad,telefono,contacto),
        encargado:personal!ordenes_encargado_personal_id_fkey(id,nombre,rol),
        orden_personal(personal:personal(id,nombre,rol,categoria_rol,disponibilidad)),
        orden_unidades(unidad:unidades(id,tipo,identificador,estado)),
        orden_articulos(cantidad,seccion,dimensiones,nota,articulo:articulos(id,nombre,categoria,stock_total)),
        orden_horarios(id,hora,descripcion)
      `).order('fecha_inicio'),
      sb.from('personal').select('*').order('nombre'),
      sb.from('unidades').select('*').order('tipo'),
      sb.from('venues').select('*').order('nombre'),
      sb.from('articulos').select('*').order('nombre'),
      sb.from('compras').select('*, orden:ordenes(nombre_evento,cliente,fecha_inicio)').order('fecha_necesaria'),
      sb.from('produccion').select('*, orden:ordenes(nombre_evento,cliente,fecha_inicio)').order('fecha_necesaria'),
      sb.from('config').select('*').eq('id',1).single()
    ]);
    for (const [name,res] of Object.entries({ordenes:ordenesRes,personal:personalRes,unidades:unidadesRes,venues:venuesRes,articulos:articulosRes,compras:comprasRes,produccion:produccionRes})){
      if(res.error) throw new Error(name+': '+res.error.message);
    }
    DB.ordenes = ordenesRes.data||[];
    DB.personal = personalRes.data||[];
    DB.unidades = unidadesRes.data||[];
    DB.venues = venuesRes.data||[];
    DB.articulos = articulosRes.data||[];
    DB.compras = comprasRes.data||[];
    DB.produccion = produccionRes.data||[];
    DB.config = configRes.data||{temporada_alta_meses:[],plantilla_staff:0,plantilla_encargados:0,plantilla_choferes:0};
    renderHeader();
    renderCurrentTab();
  }catch(err){
    console.error(err);
    toast('Error cargando datos: '+err.message, true);
  }finally{
    showLoading(false);
  }
}

function renderHeader(){
  document.getElementById('fechaHdr').textContent = new Date().toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const proximas = DB.ordenes.filter(o=>o.estado!=='Cancelada' && o.fecha_inicio>=isoLocal(today())).length;
  document.getElementById('hdrPill').innerHTML = `${proximas} <strong>órdenes próximas</strong>`;
}

/* ───────── navegación de tabs ───────── */
const TAB_TITLES = {
  ordenes:'Órdenes', semana:'Planeación semanal', calendario:'Calendario', flota:'Flota y personal',
  alertas:'Alertas', proyeccion:'Proyección', personal:'Personal', unidades:'Unidades', venues:'Venues',
  inventario:'Inventario', compras:'Compras', produccion:'Producción', reportes:'Reportes'
};
document.getElementById('navTabs').addEventListener('click', e=>{
  const btn = e.target.closest('.nav-tab'); if(!btn) return;
  document.querySelectorAll('.nav-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  state.tab = btn.dataset.tab;
  document.getElementById('topbarTitle').textContent = TAB_TITLES[state.tab] || '';
  document.querySelectorAll('.tab-panel').forEach(p=>p.style.display='none');
  document.getElementById('panel-'+state.tab).style.display='';
  renderCurrentTab();
});
document.getElementById('btnReload').addEventListener('click', loadAll);

function renderCurrentTab(){
  switch(state.tab){
    case 'ordenes': renderOrdenesTab(); break;
    case 'semana': renderSemanaTab(); break;
    case 'calendario': renderCalendarioTab(); break;
    case 'flota': renderFlotaTab(); break;
    case 'alertas': renderAlertasTab(); break;
    case 'proyeccion': renderProyeccionTab(); break;
    case 'personal': renderPersonalTab(); break;
    case 'unidades': renderUnidadesTab(); break;
    case 'venues': renderVenuesTab(); break;
    case 'inventario': renderInventarioTab(); break;
    case 'compras': renderComprasTab(); break;
    case 'produccion': renderProduccionTab(); break;
    case 'reportes': renderReportesTab(); break;
  }
  // Badge de alertas visible siempre
  const n = computeAlerts().length;
  const b = document.getElementById('badgeAlertas');
  if(n>0){ b.style.display='inline-flex'; b.textContent=n; } else { b.style.display='none'; }
}

/* ══════════════════════════ ÓRDENES ══════════════════════════ */
function ordenesFiltradas(){
  return DB.ordenes.filter(o=>{
    if(state.ordenFiltro!=='todos' && o.estado!==state.ordenFiltro) return false;
    if(state.ordenBusqueda){
      const q = state.ordenBusqueda.toLowerCase();
      const hay = [o.cliente,o.nombre_evento,o.venue?.nombre].filter(Boolean).join(' ').toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  }).sort((a,b)=> a.fecha_inicio.localeCompare(b.fecha_inicio));
}

function renderOrdenesTab(){
  const horizonte = isoLocal(addDays(today(),14));
  const proximas = DB.ordenes.filter(o=>o.fecha_inicio<=horizonte && o.fecha_fin?o.fecha_fin>=isoLocal(today()):o.fecha_inicio>=isoLocal(today()) || (o.fecha_inicio<=horizonte));
  const enVentana = DB.ordenes.filter(o=>o.estado!=='Cancelada' && o.fecha_inicio<=horizonte && (o.fecha_fin||o.fecha_inicio)>=isoLocal(today()));
  document.getElementById('kOrdenes').textContent = DB.ordenes.filter(o=>['Confirmada','Pendiente'].includes(o.estado) && o.fecha_inicio>=isoLocal(today())).length;
  const asignado = enVentana.reduce((s,o)=>s+(o.orden_personal?.length||0),0);
  const requerido = enVentana.reduce((s,o)=>s+(o.personal_requerido||0),0);
  document.getElementById('kPersonalOr').textContent = `${asignado}/${requerido}`;
  document.getElementById('kPax').textContent = enVentana.reduce((s,o)=>s+(o.pax||0),0);
  document.getElementById('kAlertasOr').textContent = computeAlerts().length;

  document.getElementById('tbOrdenes').innerHTML = ordenesFiltradas().map(o=>{
    const personalTxt = `${o.orden_personal?.length||0}/${o.personal_requerido||0}`;
    const unidadesTxt = (o.orden_unidades||[]).map(u=>u.unidad?.tipo).filter(Boolean);
    return `<tr class="fila-data" onclick="abrirDetalleOrden('${o.id}')">
      <td>${fmtRango(o.fecha_inicio,o.fecha_fin)}</td>
      <td><b>${escapeHtml(o.cliente)}</b><br><span style="color:var(--suave);font-size:10px">${escapeHtml(o.nombre_evento)}</span></td>
      <td>${escapeHtml(o.venue?.nombre||'—')}</td>
      <td class="r">${o.pax??0}</td>
      <td>${personalTxt}</td>
      <td>${unidadesTxt.length?unidadesTxt.map(u=>`<span class="unidad-tag">${escapeHtml(u)}</span>`).join(''):'—'}</td>
      <td>${escapeHtml(o.tipo||'Delivery')}</td>
      <td>${badge(o.estado)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="8"><div class="empty-state"><div class="es-ico">📭</div><p>No hay órdenes con ese filtro.</p></div></td></tr>`;
}
document.getElementById('buscarOrden').addEventListener('input', e=>{ state.ordenBusqueda=e.target.value; renderOrdenesTab(); });
document.getElementById('filtrosOrden').addEventListener('click', e=>{
  const b=e.target.closest('.filtro-btn'); if(!b) return;
  document.querySelectorAll('#filtrosOrden .filtro-btn').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); state.ordenFiltro=b.dataset.f; renderOrdenesTab();
});

/* ── Modal Orden ── */
let modalOrdenState = null;
function nuevoModalOrdenState(){
  return { id:null, personal:[], unidades:[], articulos:[], horarios:[], cargos:[] };
}
document.getElementById('btnNuevaOrden').addEventListener('click', ()=>abrirModalOrden(null));
window.abrirDetalleOrden = function(id){
  const o = DB.ordenes.find(x=>x.id===id);
  abrirModalOrden(o);
};
function abrirModalOrden(orden){
  modalOrdenState = orden ? {
    id: orden.id,
    personal: (orden.orden_personal||[]).map(p=>p.personal.id),
    unidades: (orden.orden_unidades||[]).map(u=>u.unidad.id),
    articulos: (orden.orden_articulos||[]).map(a=>({articulo_id:a.articulo.id, cantidad:a.cantidad, seccion:a.seccion, dimensiones:a.dimensiones, nota:a.nota})),
    horarios: (orden.orden_horarios||[]).map(h=>({hora:h.hora, descripcion:h.descripcion})),
    cargos: [...(orden.cargos||[])]
  } : nuevoModalOrdenState();
  document.getElementById('modalOrdenTitulo').innerHTML = orden ? `Orden — <em>${escapeHtml(orden.nombre_evento)}</em>` : `Nueva <em>orden</em>`;
  document.getElementById('btnDelOrden').style.display = orden ? '' : 'none';
  document.getElementById('modalOrdenBody').innerHTML = ordenFormHTML(orden);
  renderSubPersonal(); renderSubUnidades(); renderSubArticulos(); renderSubHorarios(); renderSubCargos();
  document.getElementById('modalOrden').classList.add('open');
}
function cerrarModales(){ document.querySelectorAll('.modal-overlay').forEach(m=>m.classList.remove('open')); }
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click', cerrarModales));

function selOptions(list, valueKey, labelFn, current){
  return `<option value="">—</option>` + list.map(x=>`<option value="${x[valueKey]}" ${String(current)===String(x[valueKey])?'selected':''}>${escapeHtml(labelFn(x))}</option>`).join('');
}
function ordenFormHTML(o){
  o = o || {};
  return `
  <div class="form-section-label">Datos generales</div>
  <div class="form-row">
    <div class="form-group"><label>Cliente <span class="req">*</span></label><input id="of_cliente" value="${escapeHtml(o.cliente||'')}"></div>
    <div class="form-group"><label>Nombre del evento <span class="req">*</span></label><input id="of_nombre_evento" value="${escapeHtml(o.nombre_evento||'')}"></div>
  </div>
  <div class="form-row">
    <div class="form-group"><label>Tipo</label><select id="of_tipo">${['Delivery','Pull-Ticket','Otro'].map(t=>`<option ${o.tipo===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div class="form-group"><label>Estado</label><select id="of_estado">${['Pendiente','Confirmada','Cancelada','Finalizada'].map(t=>`<option ${o.estado===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div class="form-group"><label>Venue</label><select id="of_venue_id">${selOptions(DB.venues,'id',v=>v.nombre,o.venue_id||o.venue?.id)}</select></div>
  </div>
  <div class="form-row">
    <div class="form-group"><label>Coordinador (planner)</label><input id="of_coordinador" value="${escapeHtml(o.coordinador||'')}"></div>
    <div class="form-group"><label>Email coordinador</label><input id="of_coordinador_email" value="${escapeHtml(o.coordinador_email||'')}"></div>
    <div class="form-group"><label>Rep. comercial</label><input id="of_rep" value="${escapeHtml(o.rep||'')}"></div>
  </div>
  <div class="form-section-label">Fechas y logística</div>
  <div class="form-row">
    <div class="form-group"><label>Fecha inicio <span class="req">*</span></label><input type="date" id="of_fecha_inicio" value="${o.fecha_inicio||''}"></div>
    <div class="form-group"><label>Fecha fin</label><input type="date" id="of_fecha_fin" value="${o.fecha_fin||''}"></div>
    <div class="form-group"><label>Hora inicio</label><input type="time" id="of_hora_inicio" value="${(o.hora_inicio||'').slice(0,5)}"></div>
    <div class="form-group"><label>Hora fin</label><input type="time" id="of_hora_fin" value="${(o.hora_fin||'').slice(0,5)}"></div>
  </div>
  <div class="form-row">
    <div class="form-group"><label>Entrega mobiliario</label><input type="date" id="of_fecha_entrega" value="${o.fecha_entrega_mobiliario||''}"></div>
    <div class="form-group"><label>Recogida mobiliario</label><input type="date" id="of_fecha_recogida" value="${o.fecha_recogida_mobiliario||''}"></div>
    <div class="form-group"><label>Pax</label><input type="number" id="of_pax" value="${o.pax??0}"></div>
  </div>
  <div class="form-row">
    <div class="form-group"><label>Personal requerido</label><input type="number" id="of_personal_requerido" value="${o.personal_requerido??0}"></div>
    <div class="form-group"><label>Personal externo contratado</label><input type="number" id="of_personal_externo" value="${o.personal_externo_contratado??0}"></div>
    <div class="form-group"><label>Encargado interno</label><select id="of_encargado_id">${selOptions(DB.personal.filter(p=>p.categoria_rol==='encargado'),'id',p=>p.nombre,o.encargado_personal_id||o.encargado?.id)}</select></div>
  </div>
  <div class="form-section-label">Notas</div>
  <div class="form-row full"><div class="form-group"><label>Detalles</label><textarea id="of_detalles">${escapeHtml(o.detalles||'')}</textarea></div></div>
  <div class="form-row full"><div class="form-group"><label>Pendientes</label><textarea id="of_pendientes">${escapeHtml(o.pendientes||'')}</textarea></div></div>
  <div class="form-row full"><div class="form-group"><label>Notas internas</label><textarea id="of_notas">${escapeHtml(o.notas||'')}</textarea></div></div>

  <div class="form-section-label">Cargos y descuentos</div>
  <div class="chip-list" id="subCargos"></div>
  <div class="chip-add-row"><input id="nuevoCargo" placeholder="Ej. Depósito por pérdida/daño: 10%"><button class="btn-add-seg" onclick="agregarCargo()">Agregar</button></div>

  <div class="form-section-label">Personal asignado</div>
  <div class="chip-list" id="subPersonal"></div>
  <div class="chip-add-row"><select id="selPersonalAdd">${selOptions(DB.personal,'id',p=>`${p.nombre} — ${p.rol}`,'')}</select><button class="btn-add-seg" onclick="agregarPersonal()">Agregar</button></div>

  <div class="form-section-label">Unidades asignadas</div>
  <div class="chip-list" id="subUnidades"></div>
  <div class="chip-add-row"><select id="selUnidadAdd">${selOptions(DB.unidades,'id',u=>`${u.tipo} · ${u.identificador||''}`,'')}</select><button class="btn-add-seg" onclick="agregarUnidad()">Agregar</button></div>

  <div class="form-section-label">Mobiliario / artículos pedidos</div>
  <div id="subArticulos"></div>
  <div class="chip-add-row" style="margin-top:6px">
    <select id="selArticuloAdd">${selOptions(DB.articulos,'id',a=>`${a.nombre} (stock ${a.stock_total})`,'')}</select>
    <input class="cant-input" type="number" id="cantArticuloAdd" placeholder="Cant." min="1" value="1">
    <input id="seccionArticuloAdd" placeholder="Sección (opcional)" style="flex:1">
    <button class="btn-add-seg" onclick="agregarArticulo()">Agregar</button>
  </div>

  <div class="form-section-label">Horarios del día</div>
  <div id="subHorarios"></div>
  <div class="chip-add-row" style="margin-top:6px">
    <input type="time" id="horaAdd" style="flex:0 0 110px">
    <input id="descHorarioAdd" placeholder="Descripción (ej. Llega camión, inicia montaje…)">
    <button class="btn-add-seg" onclick="agregarHorario()">Agregar</button>
  </div>
  `;
}
function renderSubCargos(){
  document.getElementById('subCargos').innerHTML = modalOrdenState.cargos.map((c,i)=>`<div class="chip">${escapeHtml(c)}<button onclick="quitarCargo(${i})">✕</button></div>`).join('') || `<div class="sub-empty">Sin cargos adicionales.</div>`;
}
window.agregarCargo = function(){ const v=document.getElementById('nuevoCargo').value.trim(); if(!v) return; modalOrdenState.cargos.push(v); document.getElementById('nuevoCargo').value=''; renderSubCargos(); };
window.quitarCargo = function(i){ modalOrdenState.cargos.splice(i,1); renderSubCargos(); };

function renderSubPersonal(){
  document.getElementById('subPersonal').innerHTML = modalOrdenState.personal.map((pid,i)=>{
    const p = DB.personal.find(x=>x.id===pid);
    return `<div class="chip">${escapeHtml(p?p.nombre+' · '+p.rol:'—')}<button onclick="quitarPersonal(${i})">✕</button></div>`;
  }).join('') || `<div class="sub-empty">Sin personal asignado todavía.</div>`;
}
window.agregarPersonal = function(){ const id=document.getElementById('selPersonalAdd').value; if(!id||modalOrdenState.personal.includes(id)) return; modalOrdenState.personal.push(id); renderSubPersonal(); };
window.quitarPersonal = function(i){ modalOrdenState.personal.splice(i,1); renderSubPersonal(); };

function renderSubUnidades(){
  document.getElementById('subUnidades').innerHTML = modalOrdenState.unidades.map((uid,i)=>{
    const u = DB.unidades.find(x=>x.id===uid);
    return `<div class="chip">${escapeHtml(u?u.tipo+' · '+(u.identificador||''):'—')}<button onclick="quitarUnidad(${i})">✕</button></div>`;
  }).join('') || `<div class="sub-empty">Sin unidades asignadas todavía.</div>`;
}
window.agregarUnidad = function(){ const id=document.getElementById('selUnidadAdd').value; if(!id||modalOrdenState.unidades.includes(id)) return; modalOrdenState.unidades.push(id); renderSubUnidades(); };
window.quitarUnidad = function(i){ modalOrdenState.unidades.splice(i,1); renderSubUnidades(); };

function renderSubArticulos(){
  const rows = modalOrdenState.articulos.map((a,i)=>{
    const art = DB.articulos.find(x=>x.id===a.articulo_id);
    return `<tr><td>${escapeHtml(art?.nombre||'—')}${a.seccion?`<br><span style="color:var(--suave);font-size:9.5px">${escapeHtml(a.seccion)}</span>`:''}</td><td class="r">${a.cantidad}</td><td class="r" style="width:34px"><button class="modal-close" style="color:var(--rojo)" onclick="quitarArticulo(${i})">✕</button></td></tr>`;
  }).join('');
  document.getElementById('subArticulos').innerHTML = rows ? `<table><tbody>${rows}</tbody></table>` : `<div class="sub-empty">Sin artículos agregados todavía.</div>`;
}
window.agregarArticulo = function(){
  const id=document.getElementById('selArticuloAdd').value; const cant=parseInt(document.getElementById('cantArticuloAdd').value)||1; const seccion=document.getElementById('seccionArticuloAdd').value.trim();
  if(!id) return;
  modalOrdenState.articulos.push({articulo_id:id, cantidad:cant, seccion:seccion||null, dimensiones:null, nota:null});
  document.getElementById('seccionArticuloAdd').value=''; document.getElementById('cantArticuloAdd').value='1';
  renderSubArticulos();
};
window.quitarArticulo = function(i){ modalOrdenState.articulos.splice(i,1); renderSubArticulos(); };

function renderSubHorarios(){
  document.getElementById('subHorarios').innerHTML = modalOrdenState.horarios.map((h,i)=>`<div class="chip">${(h.hora||'').slice(0,5)} — ${escapeHtml(h.descripcion)}<button onclick="quitarHorario(${i})">✕</button></div>`).join('') || `<div class="sub-empty">Sin horarios agregados todavía.</div>`;
}
window.agregarHorario = function(){
  const hora=document.getElementById('horaAdd').value; const desc=document.getElementById('descHorarioAdd').value.trim();
  if(!desc) return;
  modalOrdenState.horarios.push({hora:hora||null, descripcion:desc});
  document.getElementById('descHorarioAdd').value='';
  renderSubHorarios();
};
window.quitarHorario = function(i){ modalOrdenState.horarios.splice(i,1); renderSubHorarios(); };

document.getElementById('btnSaveOrden').addEventListener('click', async ()=>{
  const cliente = document.getElementById('of_cliente').value.trim();
  const nombre_evento = document.getElementById('of_nombre_evento').value.trim();
  const fecha_inicio = document.getElementById('of_fecha_inicio').value;
  if(!cliente || !nombre_evento || !fecha_inicio){ toast('Cliente, nombre del evento y fecha de inicio son obligatorios.', true); return; }
  const payload = {
    cliente, nombre_evento,
    tipo: document.getElementById('of_tipo').value,
    estado: document.getElementById('of_estado').value,
    venue_id: document.getElementById('of_venue_id').value || null,
    coordinador: document.getElementById('of_coordinador').value.trim() || null,
    coordinador_email: document.getElementById('of_coordinador_email').value.trim() || null,
    rep: document.getElementById('of_rep').value.trim() || null,
    fecha_inicio,
    fecha_fin: document.getElementById('of_fecha_fin').value || null,
    hora_inicio: document.getElementById('of_hora_inicio').value || null,
    hora_fin: document.getElementById('of_hora_fin').value || null,
    fecha_entrega_mobiliario: document.getElementById('of_fecha_entrega').value || null,
    fecha_recogida_mobiliario: document.getElementById('of_fecha_recogida').value || null,
    pax: parseInt(document.getElementById('of_pax').value)||0,
    personal_requerido: parseInt(document.getElementById('of_personal_requerido').value)||0,
    personal_externo_contratado: parseInt(document.getElementById('of_personal_externo').value)||0,
    encargado_personal_id: document.getElementById('of_encargado_id').value || null,
    detalles: document.getElementById('of_detalles').value.trim() || null,
    pendientes: document.getElementById('of_pendientes').value.trim() || null,
    notas: document.getElementById('of_notas').value.trim() || null,
    cargos: modalOrdenState.cargos,
    updated_at: new Date().toISOString()
  };
  showLoading(true);
  try{
    let ordenId = modalOrdenState.id;
    if(ordenId){
      const {error} = await sb.from('ordenes').update(payload).eq('id',ordenId);
      if(error) throw error;
    }else{
      const {data,error} = await sb.from('ordenes').insert(payload).select('id').single();
      if(error) throw error;
      ordenId = data.id;
    }
    // sincronizar relaciones: borrar y re-insertar (simple y seguro para este volumen de datos)
    await sb.from('orden_personal').delete().eq('orden_id', ordenId);
    if(modalOrdenState.personal.length) await sb.from('orden_personal').insert(modalOrdenState.personal.map(pid=>({orden_id:ordenId, personal_id:pid})));
    await sb.from('orden_unidades').delete().eq('orden_id', ordenId);
    if(modalOrdenState.unidades.length) await sb.from('orden_unidades').insert(modalOrdenState.unidades.map(uid=>({orden_id:ordenId, unidad_id:uid})));
    await sb.from('orden_articulos').delete().eq('orden_id', ordenId);
    if(modalOrdenState.articulos.length) await sb.from('orden_articulos').insert(modalOrdenState.articulos.map(a=>({orden_id:ordenId, articulo_id:a.articulo_id, cantidad:a.cantidad, seccion:a.seccion, dimensiones:a.dimensiones, nota:a.nota})));
    await sb.from('orden_horarios').delete().eq('orden_id', ordenId);
    if(modalOrdenState.horarios.length) await sb.from('orden_horarios').insert(modalOrdenState.horarios.map(h=>({orden_id:ordenId, hora:h.hora, descripcion:h.descripcion})));
    toast('Orden guardada.');
    cerrarModales();
    await loadAll();
  }catch(err){ console.error(err); toast('Error al guardar: '+err.message, true); }
  finally{ showLoading(false); }
});
document.getElementById('btnDelOrden').addEventListener('click', ()=>{
  confirmar('Se eliminará la orden y todas sus relaciones (personal, unidades, artículos, horarios).', async ()=>{
    showLoading(true);
    try{
      const id = modalOrdenState.id;
      await sb.from('orden_personal').delete().eq('orden_id',id);
      await sb.from('orden_unidades').delete().eq('orden_id',id);
      await sb.from('orden_articulos').delete().eq('orden_id',id);
      await sb.from('orden_horarios').delete().eq('orden_id',id);
      await sb.from('compras').delete().eq('orden_id',id);
      await sb.from('produccion').delete().eq('orden_id',id);
      const {error} = await sb.from('ordenes').delete().eq('id',id);
      if(error) throw error;
      toast('Orden eliminada.');
      cerrarModales();
      await loadAll();
    }catch(err){ toast('Error al eliminar: '+err.message, true); }
    finally{ showLoading(false); }
  });
});

/* ── confirmación genérica ── */
let confirmCallback = null;
function confirmar(msg, cb){ document.getElementById('confirmMsg').textContent=msg; confirmCallback=cb; document.getElementById('confirmOverlay').classList.add('open'); }
document.getElementById('confirmNo').addEventListener('click', ()=>document.getElementById('confirmOverlay').classList.remove('open'));
document.getElementById('confirmYes').addEventListener('click', ()=>{ document.getElementById('confirmOverlay').classList.remove('open'); if(confirmCallback) confirmCallback(); });

/* ══════════════════════════ PLANEACIÓN SEMANAL ══════════════════════════ */
function renderSemanaTab(){
  const base = addDays(startOfWeek(today()), state.semanaOffset*7);
  const dias = Array.from({length:7},(_,i)=>addDays(base,i));
  document.getElementById('semLabel').textContent = `${dias[0].toLocaleDateString('es-MX',{day:'2-digit',month:'short'})} – ${dias[6].toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'})}`;
  const hoyIso = isoLocal(today());
  document.getElementById('weekBoard').innerHTML = dias.map(d=>{
    const iso = isoLocal(d);
    const ordenesDia = DB.ordenes.filter(o=>ordenTouchesDay(o,iso)).sort((a,b)=>(a.hora_inicio||'').localeCompare(b.hora_inicio||''));
    const cards = ordenesDia.map(o=>{
      const asignado = o.orden_personal?.length||0, requerido = o.personal_requerido||0;
      const vehiculos = (o.orden_unidades||[]).map(u=>u.unidad?.identificador ? `${u.unidad.tipo} · ${u.unidad.identificador}` : u.unidad?.tipo).filter(Boolean);
      return `
      <div class="week-card st-${slug(o.estado)}" onclick="abrirDetalleOrden('${o.id}')">
        ${o.hora_inicio?`<div class="wk-time">🕒 ${o.hora_inicio.slice(0,5)}</div>`:''}
        <div class="wk-nom">${escapeHtml(o.nombre_evento)}</div>
        <div class="wk-meta">${escapeHtml(o.venue?.nombre||'Sin venue')} · ${o.pax||0} pax</div>
        <div class="wk-tags">${vehiculos.length?vehiculos.map(v=>`<span class="wk-vtag">🚚 ${escapeHtml(v)}</span>`).join(''):'<span class="wk-vtag">Sin unidad asignada</span>'}</div>
        <div class="wk-staff ${asignado<requerido?'falta':''}">👥 ${asignado}/${requerido} personal</div>
        <div class="wk-edit-hint">Clic para editar horario y staff →</div>
      </div>`;
    }).join('') || `<div class="week-empty">Sin órdenes</div>`;
    return `<div class="week-col ${iso===hoyIso?'hoy':''}">
      <div class="week-col-head"><div class="wc-dia">${d.toLocaleDateString('es-MX',{weekday:'long'})}</div><div class="wc-fecha">${d.getDate()}</div></div>
      <div class="week-col-body">${cards}</div>
    </div>`;
  }).join('');
}
document.getElementById('semAnt').addEventListener('click', ()=>{ state.semanaOffset--; renderSemanaTab(); });
document.getElementById('semSig').addEventListener('click', ()=>{ state.semanaOffset++; renderSemanaTab(); });
document.getElementById('semHoy').addEventListener('click', ()=>{ state.semanaOffset=0; renderSemanaTab(); });

/* ══════════════════════════ CALENDARIO ══════════════════════════ */
function renderCalendarioTab(){
  const now = new Date();
  if(state.calYear===null){ state.calYear=now.getFullYear(); state.calMonth=now.getMonth(); }
  const first = new Date(state.calYear, state.calMonth, 1);
  const startOffset = (first.getDay()+6)%7; // lunes=0
  const gridStart = addDays(first, -startOffset);
  const dows = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  document.getElementById('calMesLabel').textContent = first.toLocaleDateString('es-MX',{month:'long',year:'numeric'});
  const hoyIso = isoLocal(today());
  const MAX_PILLS = 3;
  let html = dows.map(d=>`<div class="cal-dow">${d}</div>`).join('');
  for(let i=0;i<42;i++){
    const d = addDays(gridStart,i);
    const iso = isoLocal(d);
    const fuera = d.getMonth()!==state.calMonth;
    const ordenesDia = DB.ordenes.filter(o=>ordenTouchesDay(o,iso)).sort((a,b)=>(a.hora_inicio||'').localeCompare(b.hora_inicio||''));
    const visibles = ordenesDia.slice(0,MAX_PILLS);
    const resto = ordenesDia.length - visibles.length;
    html += `<div class="cal-cell ${fuera?'fuera':''} ${iso===hoyIso?'hoy':''} ${iso===state.calSelDay?'sel':''}" onclick="verDiaCalendario('${iso}')">
      <div class="cal-daynum">${d.getDate()}</div>
      <div class="cal-events">
        ${visibles.map(o=>`<div class="cal-pill est-${slug(o.estado)}" data-orden-id="${o.id}">${escapeHtml(o.nombre_evento)}</div>`).join('')}
        ${resto>0?`<div class="cal-more">+${resto} más</div>`:''}
      </div>
    </div>`;
  }
  document.getElementById('calGrid').innerHTML = html;
  if(!document.getElementById('calDayDetail')){
    document.getElementById('calGrid').insertAdjacentHTML('afterend', `<div id="calDayDetail" style="margin-top:16px"></div>`);
  }
}
window.verDiaCalendario = function(iso){
  state.calSelDay = iso;
  renderCalendarioTab();
  const ordenesDia = DB.ordenes.filter(o=>ordenTouchesDay(o,iso));
  const el = document.getElementById('calDayDetail');
  el.innerHTML = `<div class="form-section-label">Órdenes del ${fmtDate(iso)}</div>` + (ordenesDia.length ? ordenesDia.map(o=>`
    <div class="week-card st-${slug(o.estado)}" style="margin-bottom:8px" onclick="abrirDetalleOrden('${o.id}')">
      <div class="wk-nom">${escapeHtml(o.cliente)} — ${escapeHtml(o.nombre_evento)}</div>
      <div class="wk-meta">${escapeHtml(o.venue?.nombre||'Sin venue')} · ${o.pax||0} pax · ${badge(o.estado)}</div>
    </div>`).join('') : `<div class="sub-empty">Sin órdenes ese día.</div>`);
};
document.getElementById('calMesAnt').addEventListener('click', ()=>{ const d=addMonths(new Date(state.calYear,state.calMonth,1),-1); state.calYear=d.getFullYear(); state.calMonth=d.getMonth(); renderCalendarioTab(); });
document.getElementById('calMesSig').addEventListener('click', ()=>{ const d=addMonths(new Date(state.calYear,state.calMonth,1),1); state.calYear=d.getFullYear(); state.calMonth=d.getMonth(); renderCalendarioTab(); });
document.getElementById('calHoy').addEventListener('click', ()=>{ const n=new Date(); state.calYear=n.getFullYear(); state.calMonth=n.getMonth(); renderCalendarioTab(); });

/* ══════════════════════════ FLOTA Y PERSONAL ══════════════════════════ */
function renderFlotaTab(){
  const horizonIso = isoLocal(addDays(today(),7));
  const hoyIso = isoLocal(today());
  const enSemana = DB.ordenes.filter(o=>o.estado!=='Cancelada' && (o.fecha_fin||o.fecha_inicio)>=hoyIso && o.fecha_inicio<=horizonIso);

  // Personal por categoría
  const categorias = [
    {key:'staff', label:'Staff de montaje', plantilla: DB.config.plantilla_staff},
    {key:'encargado', label:'Encargados de evento', plantilla: DB.config.plantilla_encargados},
    {key:'chofer', label:'Choferes', plantilla: DB.config.plantilla_choferes}
  ];
  document.getElementById('capPersonal').innerHTML = categorias.map(c=>{
    const asignadosIds = new Set();
    enSemana.forEach(o=>(o.orden_personal||[]).forEach(p=>{ if(p.personal.categoria_rol===c.key) asignadosIds.add(p.personal.id); }));
    const total = c.plantilla || DB.personal.filter(p=>p.categoria_rol===c.key).length || 1;
    const pct = Math.min(100, Math.round(asignadosIds.size/total*100));
    return `<div class="cap-row"><div class="cap-lbl">${c.label}</div><div class="cap-bar-wrap"><div class="cap-seg usado" style="width:${pct}%"></div></div><div class="cap-num">${asignadosIds.size}/${total}</div></div>`;
  }).join('');

  // Unidades por tipo
  const tipos = [...new Set(DB.unidades.map(u=>u.tipo))];
  document.getElementById('capUnidades').innerHTML = tipos.map(tipo=>{
    const totalOperativas = DB.unidades.filter(u=>u.tipo===tipo && u.estado==='Operativa').length;
    const asignadasIds = new Set();
    enSemana.forEach(o=>(o.orden_unidades||[]).forEach(u=>{ if(u.unidad.tipo===tipo) asignadasIds.add(u.unidad.id); }));
    const pct = totalOperativas ? Math.min(100, Math.round(asignadasIds.size/totalOperativas*100)) : 100;
    const color = asignadasIds.size>totalOperativas ? 'rojo':'cafe';
    return `<div class="chart-row"><div class="chart-lbl">${escapeHtml(tipo)}</div><div class="chart-bar-wrap"><div class="chart-bar ${color}" style="width:${pct}%"><span>${asignadasIds.size}/${totalOperativas}</span></div></div></div>`;
  }).join('');

  // Tabla de asignaciones próximas 14 días
  const horizon14 = isoLocal(addDays(today(),14));
  const proximas = DB.ordenes.filter(o=>o.estado!=='Cancelada' && (o.fecha_fin||o.fecha_inicio)>=hoyIso && o.fecha_inicio<=horizon14).sort((a,b)=>a.fecha_inicio.localeCompare(b.fecha_inicio));
  document.getElementById('tbFlota').innerHTML = proximas.map(o=>{
    const falta = (o.orden_personal?.length||0) < (o.personal_requerido||0);
    const unidadProblema = (o.orden_unidades||[]).some(u=>u.unidad.estado!=='Operativa');
    return `<tr class="${falta||unidadProblema?'fila-alerta':''}">
      <td>${fmtRango(o.fecha_inicio,o.fecha_fin)}</td>
      <td>${escapeHtml(o.cliente)} — ${escapeHtml(o.nombre_evento)}</td>
      <td>${(o.orden_personal||[]).map(p=>`<span class="unidad-tag">${escapeHtml(p.personal.nombre)}</span>`).join('')||'—'}${falta?`<span class="tag-warn">faltan ${(o.personal_requerido||0)-(o.orden_personal?.length||0)}</span>`:''}</td>
      <td>${(o.orden_unidades||[]).map(u=>`<span class="unidad-tag">${escapeHtml(u.unidad.tipo)}${u.unidad.estado!=='Operativa'?' ⚠':''}</span>`).join('')||'—'}</td>
      <td>${badge(o.estado)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="5"><div class="empty-state"><p>Sin órdenes en los próximos 14 días.</p></div></td></tr>`;

  renderGanttUnidades();
  renderHistorial();
}

/* ── Gantt de disponibilidad de unidades ── */
function renderGanttUnidades(){
  const DAYS = 14;
  const base = addDays(today(), state.flotaCalOffset);
  const dias = Array.from({length:DAYS},(_,i)=>addDays(base,i));
  document.getElementById('flotaCalLabel').textContent = `${dias[0].toLocaleDateString('es-MX',{day:'2-digit',month:'short'})} – ${dias[DAYS-1].toLocaleDateString('es-MX',{day:'2-digit',month:'short'})}`;
  const hoyIso = isoLocal(today());
  document.getElementById('ganttHead').innerHTML = `<th class="gantt-veh">Unidad</th>` + dias.map(d=>{
    const iso = isoLocal(d);
    return `<th class="${iso===hoyIso?'hoy':''}">${d.toLocaleDateString('es-MX',{weekday:'short'})}<br>${d.getDate()}</th>`;
  }).join('');
  document.getElementById('ganttBody').innerHTML = DB.unidades.map(u=>{
    const fueraServicio = u.estado!=='Operativa';
    const cells = dias.map(d=>{
      const iso = isoLocal(d);
      if(fueraServicio) return `<td><div class="gantt-cell fuera-servicio"></div></td>`;
      const orden = DB.ordenes.find(o=>o.estado!=='Cancelada' && (o.orden_unidades||[]).some(x=>x.unidad.id===u.id) && ordenTouchesDay(o,iso));
      if(orden){
        const color = {Confirmada:'var(--verde)',Pendiente:'var(--dorado)',Finalizada:'var(--suave)'}[orden.estado] || 'var(--cafe)';
        return `<td><div class="gantt-cell ocupada" style="background:${color}" data-orden-id="${orden.id}" onclick="abrirDetalleOrden('${orden.id}')"></div></td>`;
      }
      return `<td><div class="gantt-cell libre"></div></td>`;
    }).join('');
    return `<tr>
      <td class="gantt-veh"><div class="gantt-veh-name">${escapeHtml(u.tipo)}${fueraServicio?`<span class="badge-fuera-servicio">${escapeHtml(u.estado)}</span>`:''}</div><div class="gantt-veh-sub">${escapeHtml(u.identificador||'')}</div></td>
      ${cells}
    </tr>`;
  }).join('') || `<tr><td colspan="${DAYS+1}"><div class="empty-state"><p>Sin unidades registradas.</p></div></td></tr>`;
}
document.getElementById('flotaCalAnt').addEventListener('click', ()=>{ state.flotaCalOffset-=7; renderGanttUnidades(); });
document.getElementById('flotaCalSig').addEventListener('click', ()=>{ state.flotaCalOffset+=7; renderGanttUnidades(); });
document.getElementById('flotaCalHoy').addEventListener('click', ()=>{ state.flotaCalOffset=0; renderGanttUnidades(); });

/* ── Historial de asignaciones ── */
function historialFiltrado(){
  const q = state.historialBusqueda.toLowerCase();
  return [...DB.ordenes].filter(o=>{
    if(!q) return true;
    const personalNames = (o.orden_personal||[]).map(p=>p.personal.nombre).join(' ');
    const unidadNames = (o.orden_unidades||[]).map(u=>`${u.unidad.tipo} ${u.unidad.identificador||''}`).join(' ');
    const hay = [o.cliente,o.nombre_evento,personalNames,unidadNames].join(' ').toLowerCase();
    return hay.includes(q);
  }).sort((a,b)=> b.fecha_inicio.localeCompare(a.fecha_inicio));
}
function renderHistorial(){
  document.getElementById('tbHistorial').innerHTML = historialFiltrado().map(o=>`
    <tr class="fila-data" onclick="abrirDetalleOrden('${o.id}')">
      <td>${fmtRango(o.fecha_inicio,o.fecha_fin)}</td>
      <td>${escapeHtml(o.cliente)} — ${escapeHtml(o.nombre_evento)}</td>
      <td>${(o.orden_personal||[]).map(p=>`<span class="unidad-tag">${escapeHtml(p.personal.nombre)}</span>`).join('')||'—'}</td>
      <td>${(o.orden_unidades||[]).map(u=>`<span class="unidad-tag">${escapeHtml(u.unidad.tipo)}${u.unidad.identificador?' · '+escapeHtml(u.unidad.identificador):''}</span>`).join('')||'—'}</td>
      <td>${badge(o.estado)}</td>
    </tr>`).join('') || `<tr><td colspan="5"><div class="empty-state"><p>Sin historial disponible.</p></div></td></tr>`;
}
document.getElementById('buscarHistorial').addEventListener('input', e=>{ state.historialBusqueda=e.target.value; renderHistorial(); });

/* ══════════════════════════ ALERTAS ══════════════════════════ */
function computeAlerts(){
  const alerts = [];
  const activas = DB.ordenes.filter(o=>o.estado!=='Cancelada');

  // 1. Cruce de personal (misma persona, mismo día, 2 órdenes)
  const porDiaPersona = new Map(); // key: iso|personalId -> [{ordenId,nombre}]
  activas.forEach(o=>{
    const dias = diasEntre(o.fecha_inicio, o.fecha_fin);
    (o.orden_personal||[]).forEach(p=>{
      dias.forEach(iso=>{
        const key = iso+'|'+p.personal.id;
        if(!porDiaPersona.has(key)) porDiaPersona.set(key,[]);
        porDiaPersona.get(key).push({ordenId:o.id, nombreOrden:o.nombre_evento, cliente:o.cliente});
      });
    });
  });
  const vistoPersona = new Set();
  porDiaPersona.forEach((lista,key)=>{
    if(lista.length>1){
      const [iso,pid] = key.split('|');
      const dedupKey = pid+'|'+lista.map(l=>l.ordenId).sort().join(',');
      if(vistoPersona.has(dedupKey)) return; vistoPersona.add(dedupKey);
      const persona = DB.personal.find(x=>x.id===pid);
      alerts.push({tipo:'personal', icono:'👤', titulo:'Cruce de personal', fecha:fmtDate(iso),
        desc:`${persona?persona.nombre:'Alguien'} está asignado a ${lista.length} órdenes el mismo día: ${lista.map(l=>l.nombreOrden).join(' y ')}.`});
    }
  });

  // 2. Cruce de unidades (demanda por tipo > operativas ese día)
  const porDiaTipo = new Map();
  activas.forEach(o=>{
    const dias = diasEntre(o.fecha_inicio, o.fecha_fin);
    (o.orden_unidades||[]).forEach(u=>{
      dias.forEach(iso=>{
        const key = iso+'|'+u.unidad.tipo;
        if(!porDiaTipo.has(key)) porDiaTipo.set(key,new Set());
        porDiaTipo.get(key).add(u.unidad.id);
      });
    });
  });
  porDiaTipo.forEach((setIds,key)=>{
    const [iso,tipo] = key.split('|');
    const operativas = DB.unidades.filter(u=>u.tipo===tipo && u.estado==='Operativa').length;
    if(setIds.size>operativas){
      alerts.push({tipo:'unidad', icono:'🚚', titulo:'Cruce de unidades', fecha:fmtDate(iso),
        desc:`Se necesitan ${setIds.size} unidades tipo "${tipo}" pero solo hay ${operativas} operativas ese día.`});
    }
  });
  // unidad no operativa asignada a orden futura
  activas.filter(o=>o.fecha_inicio>=isoLocal(today())).forEach(o=>{
    (o.orden_unidades||[]).forEach(u=>{
      if(u.unidad.estado!=='Operativa'){
        alerts.push({tipo:'unidad', icono:'🔧', titulo:'Unidad no operativa asignada', fecha:fmtDate(o.fecha_inicio),
          desc:`La unidad ${u.unidad.tipo} (${u.unidad.identificador||'s/id'}) está en estado "${u.unidad.estado}" pero sigue asignada a "${o.nombre_evento}".`});
      }
    });
  });

  // 3. Cruce de mobiliario (demanda por artículo > stock ese día)
  const porDiaArticulo = new Map();
  activas.forEach(o=>{
    const dias = diasEntre(o.fecha_inicio, o.fecha_fin);
    (o.orden_articulos||[]).forEach(a=>{
      dias.forEach(iso=>{
        const key = iso+'|'+a.articulo.id;
        porDiaArticulo.set(key, (porDiaArticulo.get(key)||0) + a.cantidad);
      });
    });
  });
  porDiaArticulo.forEach((cant,key)=>{
    const [iso,artId] = key.split('|');
    const art = DB.articulos.find(a=>a.id===artId);
    if(art && cant>art.stock_total){
      alerts.push({tipo:'articulo', icono:'📦', titulo:'Cruce de mobiliario', fecha:fmtDate(iso),
        desc:`Se piden ${cant} × "${art.nombre}" pero el stock total es ${art.stock_total}.`});
    }
  });

  // 4. Capacidad — falta personal por contratar/asignar (próximos 14 días)
  const horizon14 = isoLocal(addDays(today(),14));
  activas.filter(o=>o.fecha_inicio<=horizon14 && o.fecha_inicio>=isoLocal(today())).forEach(o=>{
    const asignado = o.orden_personal?.length||0;
    if((o.personal_requerido||0) > asignado){
      alerts.push({tipo:'capacidad', icono:'⚠', titulo:'Falta personal por asignar', fecha:fmtDate(o.fecha_inicio),
        desc:`"${o.nombre_evento}" (${o.cliente}) requiere ${o.personal_requerido} y solo tiene ${asignado} asignado(s).`});
    }
  });

  return alerts.sort((a,b)=> a.fecha.localeCompare(b.fecha));
}
function renderAlertasTab(){
  const alerts = computeAlerts();
  document.getElementById('kIncTotal').textContent = alerts.length;
  document.getElementById('kIncPersonal').textContent = alerts.filter(a=>a.tipo==='personal').length;
  document.getElementById('kIncUnidad').textContent = alerts.filter(a=>a.tipo==='unidad').length;
  document.getElementById('kIncArticulo').textContent = alerts.filter(a=>a.tipo==='articulo').length;
  document.getElementById('incList').innerHTML = alerts.map(a=>`
    <div class="inc-card tipo-${a.tipo}">
      <div class="inc-ico">${a.icono}</div>
      <div class="inc-body">
        <div class="inc-top"><div class="inc-tipo-lbl">${a.titulo}</div><div class="inc-fecha">${a.fecha}</div></div>
        <div class="inc-desc">${escapeHtml(a.desc)}</div>
      </div>
    </div>`).join('') || `<div class="empty-state"><div class="es-ico">✅</div><p>Sin alertas activas por ahora.</p></div>`;
}

/* ══════════════════════════ PROYECCIÓN ══════════════════════════ */
function renderProyeccionTab(){
  const meses = Array.from({length:12},(_,i)=>addMonths(new Date(today().getFullYear(),today().getMonth(),1), i));
  const nombresMes = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const altos = new Set(DB.config.temporada_alta_meses||[]);
  document.getElementById('temporadaNote').textContent = altos.size ? `· Temporada alta: ${[...altos].map(m=>nombresMes[m-1]).join(', ')}` : '';

  const activas = DB.ordenes.filter(o=>o.estado!=='Cancelada');
  const porMes = meses.map(m=>{
    const y=m.getFullYear(), mo=m.getMonth();
    const enMes = activas.filter(o=>{ const d=toDate(o.fecha_inicio); return d.getFullYear()===y && d.getMonth()===mo; });
    return { label: nombresMes[mo]+' '+String(y).slice(2), count: enMes.length, pax: enMes.reduce((s,o)=>s+(o.pax||0),0), personal: enMes.reduce((s,o)=>s+(o.personal_requerido||0),0), esAlta: altos.has(mo+1) };
  });
  const maxCount = Math.max(1,...porMes.map(m=>m.count));
  document.getElementById('proyOrdenes').innerHTML = porMes.map(m=>`
    <div class="chart-row"><div class="chart-lbl">${m.label}</div>
      <div class="chart-bar-wrap"><div class="chart-bar ${m.esAlta?'dorado':'cafe'}" style="width:${Math.max(4,m.count/maxCount*100)}%"><span>${m.count} orden${m.count!==1?'es':''} · ${m.pax} pax</span></div></div>
    </div>`).join('');
  const maxPersonal = Math.max(1,...porMes.map(m=>m.personal));
  document.getElementById('proyPersonal').innerHTML = porMes.map(m=>`
    <div class="chart-row"><div class="chart-lbl">${m.label}</div>
      <div class="chart-bar-wrap"><div class="chart-bar ${m.esAlta?'dorado':'verde'}" style="width:${Math.max(4,m.personal/maxPersonal*100)}%"><span>${m.personal}</span></div></div>
    </div>`).join('');
}

/* ══════════════════════════ CATÁLOGOS (CRUD genérico) ══════════════════════════ */
let genState = null; // {table, id, fields, onAfterSave}

function abrirGenModal(cfg, record){
  genState = { table: cfg.table, id: record?record.id:null, fields: cfg.fields, titulo: cfg.titulo };
  document.getElementById('modalGenTitulo').innerHTML = record ? `Editar — <em>${cfg.titulo}</em>` : `Nuevo — <em>${cfg.titulo}</em>`;
  document.getElementById('btnDelGen').style.display = record ? '' : 'none';
  document.getElementById('modalGenBody').innerHTML = cfg.fields.map(f=>genFieldHTML(f, record?record[f.name]:f.default)).join('');
  document.getElementById('modalGenerico').classList.add('open');
}
function genFieldHTML(f, value){
  const id = 'gf_'+f.name;
  const req = f.required?'<span class="req">*</span>':'';
  if(f.type==='select'){
    const opts = f.options.map(o=>`<option value="${o}" ${String(value)===String(o)?'selected':''}>${o}</option>`).join('');
    return `<div class="form-row full"><div class="form-group"><label>${f.label} ${req}</label><select id="${id}">${opts}</select></div></div>`;
  }
  if(f.type==='fk'){
    const opts = f.options().map(o=>`<option value="${o.value}" ${String(value)===String(o.value)?'selected':''}>${escapeHtml(o.label)}</option>`).join('');
    return `<div class="form-row full"><div class="form-group"><label>${f.label} ${req}</label><select id="${id}"><option value="">—</option>${opts}</select></div></div>`;
  }
  if(f.type==='textarea'){
    return `<div class="form-row full"><div class="form-group"><label>${f.label}</label><textarea id="${id}">${escapeHtml(value||'')}</textarea></div></div>`;
  }
  return `<div class="form-row full"><div class="form-group"><label>${f.label} ${req}</label><input type="${f.type||'text'}" id="${id}" value="${escapeHtml(value??'')}"></div></div>`;
}
document.getElementById('btnSaveGen').addEventListener('click', async ()=>{
  const payload = {};
  for(const f of genState.fields){
    const el = document.getElementById('gf_'+f.name);
    let v = el.value;
    if(f.type==='number') v = v===''?null:Number(v);
    if(v==='') v=null;
    if(f.required && (v===null||v===undefined||v==='')){ toast(`El campo "${f.label}" es obligatorio.`, true); throw new Error('required'); }
    payload[f.name] = v;
  }
  showLoading(true);
  try{
    if(genState.id){
      const {error} = await sb.from(genState.table).update(payload).eq('id',genState.id);
      if(error) throw error;
    }else{
      const {error} = await sb.from(genState.table).insert(payload);
      if(error) throw error;
    }
    toast('Guardado correctamente.');
    cerrarModales();
    await loadAll();
  }catch(err){ if(err.message!=='required'){ console.error(err); toast('Error al guardar: '+err.message, true);} }
  finally{ showLoading(false); }
});
document.getElementById('btnDelGen').addEventListener('click', ()=>{
  confirmar('Esta acción no se puede deshacer.', async ()=>{
    showLoading(true);
    try{
      const {error} = await sb.from(genState.table).delete().eq('id',genState.id);
      if(error) throw error;
      toast('Eliminado.');
      cerrarModales();
      await loadAll();
    }catch(err){ toast('Error al eliminar: '+err.message, true); }
    finally{ showLoading(false); }
  });
});

/* ── PERSONAL ── */
const CFG_PERSONAL = { table:'personal', titulo:'persona', fields:[
  {name:'nombre', label:'Nombre', required:true},
  {name:'rol', label:'Rol (texto libre)', required:true},
  {name:'categoria_rol', label:'Categoría', type:'select', options:['staff','encargado','chofer','otro'], required:true},
  {name:'tipo', label:'Tipo', type:'select', options:['Fijo','Eventual'], default:'Fijo'},
  {name:'disponibilidad', label:'Disponibilidad', type:'select', options:['Disponible','Ocupado','Inactivo'], default:'Disponible'},
  {name:'telefono', label:'Teléfono'},
  {name:'notas', label:'Notas', type:'textarea'}
]};
function renderPersonalTab(){
  const q = state.personalBusqueda.toLowerCase();
  const list = DB.personal.filter(p=>!q || (p.nombre+' '+p.rol).toLowerCase().includes(q));
  document.getElementById('kPersTotal').textContent = DB.personal.length;
  document.getElementById('kPersDisp').textContent = DB.personal.filter(p=>p.disponibilidad==='Disponible').length;
  document.getElementById('kPersOcup').textContent = DB.personal.filter(p=>p.disponibilidad==='Ocupado').length;
  document.getElementById('kPersEvent').textContent = DB.personal.filter(p=>p.tipo==='Eventual').length;
  document.getElementById('tbPersonal').innerHTML = list.map(p=>`
    <tr class="fila-data" onclick='abrirGenModal(CFG_PERSONAL, ${JSON.stringify(p).replace(/'/g,"&#39;")})'>
      <td>${escapeHtml(p.nombre)}</td><td>${escapeHtml(p.rol)}</td><td>${escapeHtml(p.tipo)}</td><td>${escapeHtml(p.telefono||'—')}</td>
      <td>${badge(p.disponibilidad)}</td><td>${escapeHtml(p.notas||'—')}</td>
    </tr>`).join('') || `<tr><td colspan="6"><div class="empty-state"><p>Sin resultados.</p></div></td></tr>`;
}
document.getElementById('buscarPersonal').addEventListener('input', e=>{ state.personalBusqueda=e.target.value; renderPersonalTab(); });
document.getElementById('btnNuevoPersonal').addEventListener('click', ()=>abrirGenModal(CFG_PERSONAL,null));

/* ── UNIDADES ── */
const CFG_UNIDADES = { table:'unidades', titulo:'unidad', fields:[
  {name:'tipo', label:'Tipo de unidad', required:true},
  {name:'identificador', label:'Identificador / placas'},
  {name:'estado', label:'Estado', type:'select', options:['Operativa','Mantenimiento','Baja'], default:'Operativa'},
  {name:'notas', label:'Notas', type:'textarea'}
]};
function renderUnidadesTab(){
  document.getElementById('tbUnidades').innerHTML = DB.unidades.map(u=>`
    <tr class="fila-data" onclick='abrirGenModal(CFG_UNIDADES, ${JSON.stringify(u).replace(/'/g,"&#39;")})'>
      <td>${escapeHtml(u.tipo)}</td><td>${escapeHtml(u.identificador||'—')}</td><td>${badge(u.estado)}</td><td>${escapeHtml(u.notas||'—')}</td>
    </tr>`).join('') || `<tr><td colspan="4"><div class="empty-state"><p>Sin unidades registradas.</p></div></td></tr>`;
}
document.getElementById('btnNuevaUnidad').addEventListener('click', ()=>abrirGenModal(CFG_UNIDADES,null));

/* ── VENUES ── */
const CFG_VENUES = { table:'venues', titulo:'venue', fields:[
  {name:'nombre', label:'Nombre', required:true},
  {name:'direccion', label:'Dirección'},
  {name:'capacidad', label:'Capacidad', type:'number', required:true},
  {name:'contacto', label:'Contacto'},
  {name:'telefono', label:'Teléfono'},
  {name:'notas', label:'Notas', type:'textarea'}
]};
function renderVenuesTab(){
  const q = state.venueBusqueda.toLowerCase();
  const list = DB.venues.filter(v=>!q || v.nombre.toLowerCase().includes(q));
  document.getElementById('tbVenues').innerHTML = list.map(v=>`
    <tr class="fila-data" onclick='abrirGenModal(CFG_VENUES, ${JSON.stringify(v).replace(/'/g,"&#39;")})'>
      <td>${escapeHtml(v.nombre)}</td><td>${escapeHtml(v.direccion||'—')}</td><td class="r">${v.capacidad}</td><td>${escapeHtml(v.contacto||'—')}</td><td>${escapeHtml(v.telefono||'—')}</td>
    </tr>`).join('') || `<tr><td colspan="5"><div class="empty-state"><p>Sin resultados.</p></div></td></tr>`;
}
document.getElementById('buscarVenue').addEventListener('input', e=>{ state.venueBusqueda=e.target.value; renderVenuesTab(); });
document.getElementById('btnNuevoVenue').addEventListener('click', ()=>abrirGenModal(CFG_VENUES,null));

/* ── INVENTARIO (artículos) ── */
const CFG_ARTICULOS = { table:'articulos', titulo:'artículo', fields:[
  {name:'nombre', label:'Nombre', required:true},
  {name:'categoria', label:'Categoría'},
  {name:'stock_total', label:'Stock total', type:'number', required:true},
  {name:'estado_mantenimiento', label:'Estado de mantenimiento', type:'select', options:['Bueno','Necesita revisión','Malo'], default:'Bueno'},
  {name:'proxima_revision', label:'Próxima revisión', type:'date'},
  {name:'responsable_mantenimiento', label:'Responsable'},
  {name:'notas', label:'Notas', type:'textarea'}
]};
function renderInventarioTab(){
  const q = state.articuloBusqueda.toLowerCase();
  const list = DB.articulos.filter(a=>!q || a.nombre.toLowerCase().includes(q));
  document.getElementById('tbArticulos').innerHTML = list.map(a=>`
    <tr class="fila-data" onclick='abrirGenModal(CFG_ARTICULOS, ${JSON.stringify(a).replace(/'/g,"&#39;")})'>
      <td>${escapeHtml(a.nombre)}</td><td>${escapeHtml(a.categoria||'—')}</td><td class="r">${a.stock_total}</td>
      <td>${badge(a.estado_mantenimiento)}</td><td>${a.proxima_revision?fmtDate(a.proxima_revision):'—'}</td>
    </tr>`).join('') || `<tr><td colspan="5"><div class="empty-state"><p>Sin resultados.</p></div></td></tr>`;
}
document.getElementById('buscarArticulo').addEventListener('input', e=>{ state.articuloBusqueda=e.target.value; renderInventarioTab(); });
document.getElementById('btnNuevoArticulo').addEventListener('click', ()=>abrirGenModal(CFG_ARTICULOS,null));

/* ── COMPRAS ── */
const CFG_COMPRAS = { table:'compras', titulo:'solicitud de compra', fields:[
  {name:'orden_id', label:'Orden relacionada', type:'fk', options:()=>DB.ordenes.map(o=>({value:o.id,label:`${o.cliente} — ${o.nombre_evento} (${o.fecha_inicio})`}))},
  {name:'item', label:'Item', required:true},
  {name:'cantidad', label:'Cantidad', type:'number'},
  {name:'proveedor', label:'Proveedor'},
  {name:'fecha_necesaria', label:'Fecha necesaria', type:'date'},
  {name:'estado', label:'Estado', type:'select', options:['Pendiente','Ordenado','Recibido'], default:'Pendiente'},
  {name:'responsable', label:'Responsable'},
  {name:'notas', label:'Notas', type:'textarea'}
]};
function renderComprasTab(){
  document.getElementById('tbCompras').innerHTML = DB.compras.map(c=>`
    <tr class="fila-data" onclick='abrirGenModal(CFG_COMPRAS, ${JSON.stringify(c).replace(/'/g,"&#39;")})'>
      <td>${c.orden?escapeHtml(c.orden.cliente+' — '+c.orden.nombre_evento):'—'}</td><td>${escapeHtml(c.item)}</td><td class="r">${c.cantidad??'—'}</td>
      <td>${escapeHtml(c.proveedor||'—')}</td><td>${c.fecha_necesaria?fmtDate(c.fecha_necesaria):'—'}</td><td>${badge(c.estado)}</td><td>${escapeHtml(c.responsable||'—')}</td>
    </tr>`).join('') || `<tr><td colspan="7"><div class="empty-state"><p>Sin solicitudes registradas.</p></div></td></tr>`;
}
document.getElementById('btnNuevaCompra').addEventListener('click', ()=>abrirGenModal(CFG_COMPRAS,null));

/* ── PRODUCCIÓN ── */
const CFG_PRODUCCION = { table:'produccion', titulo:'tarea de producción', fields:[
  {name:'orden_id', label:'Orden relacionada', type:'fk', options:()=>DB.ordenes.map(o=>({value:o.id,label:`${o.cliente} — ${o.nombre_evento} (${o.fecha_inicio})`}))},
  {name:'tarea', label:'Tarea', required:true},
  {name:'categoria', label:'Categoría'},
  {name:'fecha_necesaria', label:'Fecha necesaria', type:'date'},
  {name:'estado', label:'Estado', type:'select', options:['Pendiente','En Proceso','Completado'], default:'Pendiente'},
  {name:'responsable', label:'Responsable'},
  {name:'notas', label:'Notas', type:'textarea'}
]};
function renderProduccionTab(){
  document.getElementById('tbProduccion').innerHTML = DB.produccion.map(p=>`
    <tr class="fila-data" onclick='abrirGenModal(CFG_PRODUCCION, ${JSON.stringify(p).replace(/'/g,"&#39;")})'>
      <td>${p.orden?escapeHtml(p.orden.cliente+' — '+p.orden.nombre_evento):'—'}</td><td>${escapeHtml(p.tarea)}</td><td>${escapeHtml(p.categoria||'—')}</td>
      <td>${p.fecha_necesaria?fmtDate(p.fecha_necesaria):'—'}</td><td>${badge(p.estado)}</td><td>${escapeHtml(p.responsable||'—')}</td>
    </tr>`).join('') || `<tr><td colspan="6"><div class="empty-state"><p>Sin tareas registradas.</p></div></td></tr>`;
}
document.getElementById('btnNuevaProduccion').addEventListener('click', ()=>abrirGenModal(CFG_PRODUCCION,null));

/* ══════════════════════════ REPORTES ══════════════════════════ */
function barListHTML(rows, colorClass){
  const max = Math.max(1,...rows.map(r=>r.val));
  return rows.map(r=>`<div class="chart-row"><div class="chart-lbl">${escapeHtml(r.label)}</div><div class="chart-bar-wrap"><div class="chart-bar ${colorClass}" style="width:${Math.max(4,r.val/max*100)}%"><span>${r.val}</span></div></div></div>`).join('') || `<div class="sub-empty">Sin datos.</div>`;
}
function renderReportesTab(){
  const meses = {};
  DB.ordenes.filter(o=>o.estado!=='Cancelada').forEach(o=>{ const k=o.fecha_inicio.slice(0,7); meses[k]=(meses[k]||0)+1; });
  document.getElementById('rptOrdenesMes').innerHTML = barListHTML(Object.entries(meses).sort().map(([k,v])=>({label:k,val:v})),'cafe');

  const paxVenue = {};
  DB.ordenes.filter(o=>o.estado!=='Cancelada' && o.venue).forEach(o=>{ paxVenue[o.venue.nombre]=(paxVenue[o.venue.nombre]||0)+(o.pax||0); });
  document.getElementById('rptPaxVenue').innerHTML = barListHTML(Object.entries(paxVenue).map(([k,v])=>({label:k,val:v})),'verde');

  const compEstado = {}; DB.compras.forEach(c=>compEstado[c.estado]=(compEstado[c.estado]||0)+1);
  document.getElementById('rptCompras').innerHTML = barListHTML(Object.entries(compEstado).map(([k,v])=>({label:k,val:v})),'dorado');

  const prodEstado = {}; DB.produccion.forEach(p=>prodEstado[p.estado]=(prodEstado[p.estado]||0)+1);
  document.getElementById('rptProduccion').innerHTML = barListHTML(Object.entries(prodEstado).map(([k,v])=>({label:k,val:v})),'cafe');

  const artCount = {};
  DB.ordenes.forEach(o=>(o.orden_articulos||[]).forEach(a=>{ artCount[a.articulo.nombre]=(artCount[a.articulo.nombre]||0)+a.cantidad; }));
  document.getElementById('rptArticulos').innerHTML = barListHTML(Object.entries(artCount).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v])=>({label:k,val:v})),'verde');

  const unidEstado = {}; DB.unidades.forEach(u=>unidEstado[u.estado]=(unidEstado[u.estado]||0)+1);
  document.getElementById('rptUnidades').innerHTML = barListHTML(Object.entries(unidEstado).map(([k,v])=>({label:k,val:v})),'dorado');
}

/* ───────── init ───────── */
loadAll();

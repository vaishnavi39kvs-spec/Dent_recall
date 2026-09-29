/* ==========================================================
   DentRecall - Vanilla JavaScript + Bootstrap
   No React
  Neon PostgreSQL persistence through the local API
   ========================================================== */

const DB_KEY = "dentrecall_db_v1";
const SESSION_KEY = "dentrecall_session_v1";
const USERS_KEY = "dentrecall_users_v1";
const API_STATE_URL = "/api/state";

const state = {
  patients: [],
  visits: [],
  selectedId: null,
  activeTab: "patients",
  search: "",
  editingPatientId: null,
  editingVisitId: null,
  calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  calendarFilter: null
};

const patientModal = new bootstrap.Modal("#patientModal");
const visitModal = new bootstrap.Modal("#visitModal");
const detailModal = new bootstrap.Modal("#detailModal");
const toastEl = bootstrap.Toast.getOrCreateInstance("#toast");
const signupModal = new bootstrap.Modal("#signupModal");

function uid(prefix="id"){
  return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2,8);
}
function today(){
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime()-off*60000).toISOString().slice(0,10);
}
function addMonths(dateString, months){
  const d = new Date(dateString + "T00:00:00");
  d.setMonth(d.getMonth()+months);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime()-off*60000).toISOString().slice(0,10);
}
function money(n){ return "₹" + Math.round(Number(n)||0).toLocaleString("en-IN"); }
function num(v){ const n=Number(v); return Number.isFinite(n)&&n>=0 ? n : 0; }
function friendlyDate(s){
  if(!s) return "—";
  const [y,m,d]=s.split("-");
  return `${d}-${m}-${y}`;
}
function esc(v){
  return String(v ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function getEstimatedBill(patient){
  // Legacy records may only have treatmentEstimate; keep them working.
  const consultation=num(patient.estimatedConsultationCharge);
  const iopa=num(patient.estimatedIopaCharge);
  const treatment=num(patient.treatmentCost);
  const hasBreakdown=[patient.estimatedConsultationCharge,patient.estimatedIopaCharge,patient.treatmentCost].some(v=>v!==undefined && v!==null && v!=="");
  return hasBreakdown ? consultation+iopa+treatment : num(patient.treatmentEstimate);
}
function billing(patient){
  const visits = state.visits.filter(v=>v.patientId===patient.id);
  const visitCharges = visits.reduce((s,v)=>s+num(v.consultationCharge)+num(v.iopaCharge)+num(v.additionalCharge),0);
  const paidAmount = num(patient.initialPaidAmount) + visits.reduce((s,v)=>s+num(v.paymentAmount),0);
  const estimatedBill = getEstimatedBill(patient);
  const totalBill = estimatedBill+visitCharges;
  return {estimatedBill,visitCharges,totalBill,paidAmount,balance:totalBill-paidAmount};
}
async function saveDB(){
  const data={patients:state.patients,visits:state.visits};
  localStorage.setItem(DB_KEY, JSON.stringify(data));
  const response=await fetch(API_STATE_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  if(!response.ok) throw new Error("Database save failed.");
}
async function loadDB(){
  try{
    const response=await fetch(API_STATE_URL);
    if(!response.ok) throw new Error("Database load failed.");
    const data=await response.json();
    state.patients=Array.isArray(data.patients)?data.patients:[];
    state.visits=Array.isArray(data.visits)?data.visits:[];
    localStorage.setItem(DB_KEY,JSON.stringify({patients:state.patients,visits:state.visits}));
  }catch(e){
    try{
      const data=JSON.parse(localStorage.getItem(DB_KEY)||"{}");
      state.patients=Array.isArray(data.patients)?data.patients:[];
      state.visits=Array.isArray(data.visits)?data.visits:[];
    }catch(localError){ state.patients=[];state.visits=[]; }
  }
}
function isLoggedIn(){ return localStorage.getItem(SESSION_KEY)==="true"; }
function toast(msg){
  document.getElementById("toastText").textContent=msg;
  toastEl.show();
}
function confirmDelete(message){ return window.confirm(message); }

/* ---------- Auth ---------- */
function getUsers(){
  try{
    const users=JSON.parse(localStorage.getItem(USERS_KEY)||"[]");
    return Array.isArray(users)?users:[];
  }catch(e){return [];}
}
function saveUsers(users){ localStorage.setItem(USERS_KEY,JSON.stringify(users)); }
function selectedOptions(selectId){
  return Array.from(document.getElementById(selectId).selectedOptions).map(o=>o.value);
}
function renderSelectedSpecializations(){
  const values=selectedOptions("signupSpecializations");
  document.getElementById("signupSpecializationHint").innerHTML=values.length
    ? values.map(v=>`<span class="badge rounded-pill text-bg-light border me-1 mb-1">${esc(v)}</span>`).join("")
    : `<span class="text-muted small">No specialization selected yet.</span>`;
}
function renderAuth(){
  document.getElementById("app").innerHTML=`
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-brand">
          <div class="brand-mark"><i class="bi bi-heart-pulse fs-4"></i></div>
          <h1>DentRecall</h1>
          <p>Dental clinic patient recall & billing log</p>
        </div>
        <div class="alert alert-info small mt-4">
          <i class="bi bi-info-circle me-1"></i>
          Patient and visit records are stored in Neon PostgreSQL through the local API.
        </div>
        <form id="authForm">
          <label class="form-label">Clinic/staff email</label>
          <input id="loginEmail" type="email" class="form-control mb-3" required placeholder="doctor@clinic.com">
          <label class="form-label">Password</label>
          <input id="loginPassword" type="password" class="form-control mb-3" minlength="6" required placeholder="At least 6 characters">
          <button class="btn btn-primary w-100">Sign in</button>
        </form>
        <div class="auth-divider"><span>New to DentRecall?</span></div>
        <button class="btn btn-outline-primary w-100" id="openSignupBtn"><i class="bi bi-person-plus me-1"></i> Create new account</button>
        <p class="small text-muted text-center mt-3 mb-0">Account details are stored in this browser for this demo; patient and visit records use Neon PostgreSQL.</p>
      </div>
    </div>`;

  document.getElementById("authForm").addEventListener("submit",e=>{
    e.preventDefault();
    const email=document.getElementById("loginEmail").value.trim().toLowerCase();
    const password=document.getElementById("loginPassword").value;
    const users=getUsers();
    const account=users.find(u=>u.email===email);
    if(users.length && !account){ alert("No account was found with this email. Please use Sign up first."); return; }
    if(account && account.password!==password){ alert("Incorrect password."); return; }
    localStorage.setItem(SESSION_KEY,"true");
    renderApp();
  });
  document.getElementById("openSignupBtn").onclick=()=>{
    document.getElementById("signupForm").reset();
    renderSelectedSpecializations();
    signupModal.show();
  };
  document.getElementById("signupSpecializations").addEventListener("change",renderSelectedSpecializations);
  renderSelectedSpecializations();
}

document.getElementById("signupForm").addEventListener("submit",e=>{
  e.preventDefault();
  const name=document.getElementById("signupName").value.trim();
  const clinic=document.getElementById("signupClinic").value.trim();
  const email=document.getElementById("signupEmail").value.trim().toLowerCase();
  const password=document.getElementById("signupPassword").value;
  const specializations=selectedOptions("signupSpecializations");
  if(!name||!clinic||!email||password.length<6||!specializations.length){
    alert("Please complete all required fields and select at least one specialization."); return;
  }
  const users=getUsers();
  if(users.some(u=>u.email===email)){ alert("An account with this email already exists. Please sign in."); return; }
  users.push({id:uid("u"),name,clinic,email,password,specializations,createdAt:new Date().toISOString()});
  saveUsers(users);
  signupModal.hide();
  document.getElementById("loginEmail").value=email;
  document.getElementById("loginPassword").value=password;
  toast("Account created successfully. You can now sign in.");
});

/* ---------- Main UI ---------- */
async function renderApp(){
  await loadDB();
  document.getElementById("app").innerHTML=`
  <header class="topbar sticky-top">
    <div class="container-fluid px-3 px-md-4">
      <div class="d-flex align-items-center justify-content-between py-3">
        <div class="d-flex align-items-center gap-2">
          <div class="brand-mark"><i class="bi bi-heart-pulse"></i></div>
          <div><div class="brand-title">DentRecall</div><div class="brand-sub">Dental clinic patient recall & billing</div></div>
        </div>
        <div class="d-flex align-items-center gap-2">
          <span class="badge text-bg-success d-none d-md-inline"><i class="bi bi-circle-fill me-1" style="font-size:7px"></i> Neon database</span>
                    <span class="badge text-bg-success d-none d-md-inline"><i class="bi bi-circle-fill me-1" style="font-size:7px"></i> Neon database</span>
          <button class="btn btn-outline-secondary btn-sm" id="exportBtn" title="Export CSV"><i class="bi bi-download"></i></button>
          <button class="btn btn-outline-secondary btn-sm" id="logoutBtn" title="Sign out"><i class="bi bi-box-arrow-right"></i></button>
        </div>
      </div>
    </div>
  </header>

  <main class="shell">
    <div class="d-flex justify-content-between align-items-center gap-3 mb-4 flex-wrap">
      <div><h1 class="mb-1">Clinic dashboard</h1><p class="text-muted mb-0">Track visits, treatment payments, recalls and outstanding balances in one patient timeline.</p></div>
      <button class="btn btn-primary" id="newPatientBtn"><i class="bi bi-plus-lg me-1"></i> New patient</button>
    </div>

    <div class="row g-3 mb-4" id="metrics"></div>

    <section class="calendar-card mb-4">
      <div class="calendar-head">
        <div><h5 class="mb-1">Monthly appointment calendar</h5><p class="text-muted mb-0">Click a date's new-patient or recall count to view those patients in the patient list.</p></div>
        <div class="d-flex align-items-center gap-2">
          <button class="btn btn-sm btn-outline-secondary" id="prevMonthBtn"><i class="bi bi-chevron-left"></i></button>
          <strong id="calendarMonthLabel" class="calendar-month-label"></strong>
          <button class="btn btn-sm btn-outline-secondary" id="nextMonthBtn"><i class="bi bi-chevron-right"></i></button>
          <button class="btn btn-sm btn-outline-primary" id="todayMonthBtn">Today</button>
        </div>
      </div>
      <div id="monthlyCalendar"></div>
    </section>

    <div class="toolbar">
      <ul class="nav nav-pills" id="mainTabs">
        <li class="nav-item"><button class="nav-link active" data-tab="patients">All patients</button></li>
        <li class="nav-item"><button class="nav-link" data-tab="recalls">Recall log</button></li>
      </ul>
      <div class="search-box"><i class="bi bi-search text-muted"></i><input id="searchInput" placeholder="Search name, phone or diagnosis…"></div>
    </div>

    <div id="alertArea"></div>
    <div id="calendarFilterNote"></div>

    <section class="table-card">
      <div class="table-responsive">
        <table class="table table-hover align-middle">
          <thead><tr><th>Patient</th><th>First visit</th><th>Estimated bill</th><th>Total bill*</th><th>Paid</th><th>Balance</th><th>Recall</th><th></th></tr></thead>
          <tbody id="patientRows"></tbody>
        </table>
      </div>
      <div class="table-note">* Estimated bill = consultation + IOPA + treatment cost entered at patient creation. Total bill also reflects visit-level charges recorded later.</div>
    </section>
  </main>
  <footer>Built with HTML + CSS + Bootstrap + vanilla JavaScript. Data is stored in Neon PostgreSQL.</footer>`;

  document.getElementById("newPatientBtn").onclick=()=>openPatientModal();
  document.getElementById("exportBtn").onclick=exportCSV;
  document.getElementById("logoutBtn").onclick=()=>{localStorage.removeItem(SESSION_KEY);renderAuth();};
  document.getElementById("searchInput").addEventListener("input",e=>{state.search=e.target.value;renderPatients();});
  document.getElementById("prevMonthBtn").onclick=()=>{state.calendarMonth.setMonth(state.calendarMonth.getMonth()-1);renderCalendar();};
  document.getElementById("nextMonthBtn").onclick=()=>{state.calendarMonth.setMonth(state.calendarMonth.getMonth()+1);renderCalendar();};
  document.getElementById("todayMonthBtn").onclick=()=>{const d=new Date();state.calendarMonth=new Date(d.getFullYear(),d.getMonth(),1);renderCalendar();};
  document.querySelectorAll("#mainTabs .nav-link").forEach(btn=>btn.onclick=()=>{
    state.activeTab=btn.dataset.tab;
    state.calendarFilter=null;
    document.querySelectorAll("#mainTabs .nav-link").forEach(x=>x.classList.remove("active"));
    btn.classList.add("active");
    renderPatients();
  });
  renderMetrics();
  renderCalendar();
  renderPatients();
}

function renderMetrics(){
  const pending=state.patients.filter(p=>p.recallStatus==="pending").length;
  const overdue=state.patients.filter(p=>p.recallStatus==="pending"&&p.recallDate<today()).length;
  const dueToday=state.patients.filter(p=>p.recallStatus==="pending"&&p.recallDate===today()).length;
  document.getElementById("metrics").innerHTML=`
    <div class="col-6 col-xl-3"><div class="metric-card"><div class="metric-icon"><i class="bi bi-people"></i></div><div><span class="metric-label">Total patients</span><strong class="metric-value">${state.patients.length}</strong></div></div></div>
    <div class="col-6 col-xl-3"><div class="metric-card"><div class="metric-icon"><i class="bi bi-calendar-check"></i></div><div><span class="metric-label">Recalls due today</span><strong class="metric-value">${dueToday}</strong></div></div></div>
    <div class="col-6 col-xl-3"><div class="metric-card"><div class="metric-icon danger"><i class="bi bi-exclamation-circle"></i></div><div><span class="metric-label">Overdue recalls</span><strong class="metric-value">${overdue}</strong></div></div></div>
    <div class="col-6 col-xl-3"><div class="metric-card"><div class="metric-icon"><i class="bi bi-currency-rupee"></i></div><div><span class="metric-label">Pending recalls</span><strong class="metric-value">${pending}</strong></div></div></div>`;
}

function formatMonthTitle(d){return d.toLocaleDateString("en-IN",{month:"long",year:"numeric"});}
function dateKey(y,m,d){return `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;}
function renderCalendar(){
  const wrap=document.getElementById("monthlyCalendar");
  const label=document.getElementById("calendarMonthLabel");
  if(!wrap||!label)return;
  const month=new Date(state.calendarMonth.getFullYear(),state.calendarMonth.getMonth(),1);
  label.textContent=formatMonthTitle(month);
  const y=month.getFullYear(), m=month.getMonth();
  const firstDay=new Date(y,m,1).getDay();
  const days=new Date(y,m+1,0).getDate();
  const prevDays=new Date(y,m,0).getDate();
  let cells=[];
  for(let i=0;i<42;i++){
    const offset=i-firstDay;
    let day, yy=y, mm=m, outside=false;
    if(offset<0){day=prevDays+offset; mm=m-1; if(mm<0){mm=11;yy--;} outside=true;}
    else if(offset>=days){day=offset-days+1; mm=m+1; if(mm>11){mm=0;yy++;} outside=true;}
    else day=offset+1;
    const key=dateKey(yy,mm,day);
    const newCount=state.patients.filter(p=>p.firstConsultationDate===key).length;
    const recallCount=state.patients.filter(p=>p.recallDate===key).length;
    const isToday=key===today();
    cells.push(`<div class="calendar-day ${outside?'outside-month':''} ${isToday?'today':''}">
      <div class="calendar-date">${day}</div>
      <div class="calendar-counts">
        ${newCount?`<button class="calendar-link new" data-cal-date="${key}" data-cal-type="new"><span>New</span><b>${newCount}</b></button>`:`<span class="calendar-zero">New 0</span>`}
        ${recallCount?`<button class="calendar-link recall" data-cal-date="${key}" data-cal-type="recall"><span>Recall</span><b>${recallCount}</b></button>`:`<span class="calendar-zero">Recall 0</span>`}
      </div>
    </div>`);
  }
  wrap.innerHTML=`<div class="calendar-weekdays">${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(x=>`<div>${x}</div>`).join("")}</div><div class="calendar-grid">${cells.join("")}</div>`;
  wrap.querySelectorAll("[data-cal-date]").forEach(btn=>btn.onclick=()=>{
    state.calendarFilter={date:btn.dataset.calDate,type:btn.dataset.calType};
    state.search="";
    document.getElementById("searchInput").value="";
    document.querySelectorAll("#mainTabs .nav-link").forEach(x=>x.classList.toggle("active",x.dataset.tab==="patients"));
    state.activeTab="patients";
    renderPatients();
    document.getElementById("patientRows")?.closest(".table-card")?.scrollIntoView({behavior:"smooth",block:"start"});
  });
}

function filteredPatients(){
  let list=[...state.patients];
  if(state.calendarFilter){
    const {date,type}=state.calendarFilter;
    list=list.filter(p=>type==="new" ? p.firstConsultationDate===date : p.recallDate===date);
  }else if(state.activeTab==="recalls") list=list.filter(p=>p.recallStatus==="pending");
  const q=state.search.trim().toLowerCase();
  if(q) list=list.filter(p=>
    p.name.toLowerCase().includes(q) ||
    String(p.phone).includes(q) ||
    String(p.diagnosis||"").toLowerCase().includes(q)
  );
  return list.sort((a,b)=>a.name.localeCompare(b.name));
}

function renderPatients(){
  const rows=document.getElementById("patientRows");
  if(!rows) return;
  const list=filteredPatients();
  const filterNote=document.getElementById("calendarFilterNote");
  if(filterNote){
    filterNote.innerHTML=state.calendarFilter?`<div class="alert alert-primary d-flex justify-content-between align-items-center py-2"><span><i class="bi bi-calendar3 me-1"></i> Showing ${state.calendarFilter.type==="new"?"new patients":"recalls"} for ${friendlyDate(state.calendarFilter.date)}.</span><button class="btn btn-sm btn-outline-primary" id="clearCalendarFilter">Show all patients</button></div>`:"";
    document.getElementById("clearCalendarFilter")?.addEventListener("click",()=>{state.calendarFilter=null;renderPatients();});
  }
  if(!list.length){
    rows.innerHTML=`<tr><td colspan="8"><div class="empty"><i class="bi bi-people"></i><b>No patients found</b><span>Add your first patient to start the recall log.</span></div></td></tr>`;
    return;
  }
  rows.innerHTML=list.map(p=>{
    const b=billing(p);
    return `<tr class="cursor-pointer" data-open="${p.id}">
      <td><div class="patient-cell"><div class="avatar">${esc(p.name.slice(0,1).toUpperCase())}</div><div><b>${esc(p.name)}</b><small>${esc(p.phone)}</small></div></div></td>
      <td>${friendlyDate(p.firstConsultationDate)}</td>
      <td>${money(getEstimatedBill(p))}</td>
      <td><b>${money(b.totalBill)}</b></td>
      <td class="paid">${money(b.paidAmount)}</td>
      <td class="${b.balance>0?'balance':''}">${money(b.balance)}</td>
      <td><span class="status ${esc(p.recallStatus)}">${esc(p.recallStatus)}</span><small>${friendlyDate(p.recallDate)}</small></td>
      <td><button class="btn btn-sm btn-outline-primary open-btn" data-open="${p.id}">Open <i class="bi bi-chevron-right"></i></button></td>
    </tr>`;
  }).join("");
  rows.querySelectorAll("[data-open]").forEach(el=>el.addEventListener("click",e=>{
    e.stopPropagation(); openDetail(el.dataset.open);
  }));
}

/* ---------- Patient CRUD ---------- */
function openPatientModal(id=null){
  state.editingPatientId=id;
  const p=id?state.patients.find(x=>x.id===id):null;
  document.getElementById("patientModalTitle").textContent=p?"Edit patient":"Add new patient";
  document.getElementById("patientId").value=id||"";
  document.getElementById("pName").value=p?.name||"";
  document.getElementById("pPhone").value=p?.phone||"";
  document.getElementById("pAge").value=p?.age??"";
  document.getElementById("pGender").value=p?.gender||"Female";
  document.getElementById("pFirstDate").value=p?.firstConsultationDate||today();
  document.getElementById("pRecallDate").value=p?.recallDate||addMonths(today(),6);
  document.getElementById("pSpecialization").value=p?.specialization||"";
  document.getElementById("pToothArea").value=p?.toothArea||"";
  document.getElementById("pEstimateConsultation").value=p?.estimatedConsultationCharge??"";
  document.getElementById("pEstimateIopa").value=p?.estimatedIopaCharge??"";
  document.getElementById("pEstimateTreatment").value=p?.treatmentCost??p?.treatmentEstimate??"";
  updateEstimatedBillTotal();
  document.getElementById("pAddress").value=p?.address||"";
  document.getElementById("pDiagnosis").value=p?.diagnosis||"";
  document.getElementById("pPlan").value=p?.treatmentPlan||"";
  document.getElementById("pPrescription").value=p?.prescription||"";
  document.getElementById("pInitialPaid").value=p?.initialPaidAmount??"";
  document.getElementById("pAppointmentStatus").value=p?.appointmentStatus||p?.recallStatus||"pending";
  document.getElementById("pNextAppointment").value=p?.nextAppointment||p?.recallDate||"";
  document.getElementById("pNextAppointmentTime").value=p?.nextAppointmentTime||"";
  document.getElementById("pRecallStatus").value=p?.recallStatus||"pending";
  updateInitialBalance();
  document.getElementById("savePatientBtn").textContent=p?"Update patient":"Save patient";
  patientModal.show();
}

function updateEstimatedBillTotal(){
  const total=num(document.getElementById("pEstimateConsultation").value)+num(document.getElementById("pEstimateIopa").value)+num(document.getElementById("pEstimateTreatment").value);
  const el=document.getElementById("pEstimateTotal");
  if(el)el.textContent=money(total);
  updateInitialBalance();
}
["pEstimateConsultation","pEstimateIopa","pEstimateTreatment"].forEach(id=>document.getElementById(id).addEventListener("input",updateEstimatedBillTotal));
document.getElementById("pInitialPaid").addEventListener("input",updateInitialBalance);
function updateInitialBalance(){
  const total=num(document.getElementById("pEstimateConsultation").value)+num(document.getElementById("pEstimateIopa").value)+num(document.getElementById("pEstimateTreatment").value);
  const paid=num(document.getElementById("pInitialPaid").value);
  const el=document.getElementById("pInitialBalance");
  if(el)el.textContent=money(total-paid);
}
["pEstimateConsultation","pEstimateIopa","pEstimateTreatment"].forEach(id=>document.getElementById(id).addEventListener("input",updateInitialBalance));

document.getElementById("patientForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const first=document.getElementById("pFirstDate").value;
  const recall=document.getElementById("pRecallDate").value;
  if(recall<first){alert("Recall date cannot be earlier than the first consultation date.");return;}
  const data={
    name:document.getElementById("pName").value.trim(),
    phone:document.getElementById("pPhone").value.trim(),
    age:document.getElementById("pAge").value?Number(document.getElementById("pAge").value):null,
    gender:document.getElementById("pGender").value,
    firstConsultationDate:first,
    recallDate:recall,
    specialization:document.getElementById("pSpecialization").value,
    toothArea:document.getElementById("pToothArea").value.trim(),
    estimatedConsultationCharge:num(document.getElementById("pEstimateConsultation").value),
    estimatedIopaCharge:num(document.getElementById("pEstimateIopa").value),
    treatmentCost:num(document.getElementById("pEstimateTreatment").value),
    treatmentEstimate:num(document.getElementById("pEstimateConsultation").value)+num(document.getElementById("pEstimateIopa").value)+num(document.getElementById("pEstimateTreatment").value),
    address:document.getElementById("pAddress").value.trim(),
    diagnosis:document.getElementById("pDiagnosis").value.trim(),
    treatmentPlan:document.getElementById("pPlan").value.trim(),
    prescription:document.getElementById("pPrescription").value.trim(),
    initialPaidAmount:num(document.getElementById("pInitialPaid").value),
    appointmentStatus:document.getElementById("pAppointmentStatus").value,
    nextAppointment:document.getElementById("pNextAppointment").value,
    nextAppointmentTime:document.getElementById("pNextAppointmentTime").value,
    recallStatus:document.getElementById("pRecallStatus").value
  };
  if(data.initialPaidAmount>data.treatmentEstimate){alert("Paid amount cannot be greater than the estimated bill.");return;}
  if(!data.name||!/^[0-9]{10}$/.test(data.phone)){alert("Please enter a patient name and valid 10-digit phone number.");return;}
  if(state.editingPatientId){
    const i=state.patients.findIndex(p=>p.id===state.editingPatientId);
    if(i>=0) state.patients[i]={...state.patients[i],...data};
    toast("Patient record updated.");
  }else{
    const p={id:uid("p"),...data,createdAt:new Date().toISOString()};
    state.patients.push(p);
    state.selectedId=p.id;
    toast("Patient added successfully.");
  }
  try{ await saveDB(); patientModal.hide(); await renderApp(); }
  catch(error){ alert("Patient saved locally, but the database could not be reached."); }
});

/* ---------- Patient Detail ---------- */
function openDetail(id){
  state.selectedId=id;
  const p=state.patients.find(x=>x.id===id);
  if(!p) return;
  document.getElementById("detailTitle").textContent=p.name;
  renderDetail();
  detailModal.show();
}
function renderDetail(){
  const p=state.patients.find(x=>x.id===state.selectedId);
  if(!p)return;
  const b=billing(p);
  const visits=state.visits.filter(v=>v.patientId===p.id).sort((a,b)=>a.visitDate.localeCompare(b.visitDate));
  document.getElementById("detailBody").innerHTML=`
    <div class="detail-header d-flex justify-content-between align-items-start gap-3 flex-wrap mb-3">
      <div><span class="text-muted">${esc(p.phone)} · ${p.age?esc(p.age)+" years":"Age not entered"}</span><p class="mb-0 mt-1">${esc(p.diagnosis||"No diagnosis entered.")}</p></div>
      <div class="d-flex gap-2"><button class="btn btn-outline-secondary btn-sm" id="editPatientBtn"><i class="bi bi-pencil me-1"></i>Edit patient</button><button class="btn btn-danger-soft btn-sm" id="deletePatientBtn"><i class="bi bi-trash me-1"></i>Delete</button></div>
    </div>

    <div class="row g-2 mb-4">
      <div class="col-6 col-lg"><div class="bill-card"><span>Estimated bill</span><strong>${money(b.estimatedBill)}</strong></div></div>
      <div class="col-6 col-lg"><div class="bill-card"><span>Initial visit paid</span><strong class="text-success">${money(p.initialPaidAmount||0)}</strong></div></div>
      <div class="col-6 col-lg"><div class="bill-card"><span>Visit charges</span><strong>${money(b.visitCharges)}</strong></div></div>
      <div class="col-6 col-lg"><div class="bill-card billing-total"><span>Total bill</span><strong>${money(b.totalBill)}</strong></div></div>
      <div class="col-6 col-lg"><div class="bill-card"><span>Paid so far</span><strong class="text-success">${money(b.paidAmount)}</strong></div></div>
      <div class="col-12 col-lg"><div class="bill-card"><span>Balance</span><strong class="${b.balance>0?'text-warning':''}">${money(b.balance)}</strong></div></div>
    </div>

    <div class="timeline-head">
      <div><h5>Visit & payment timeline</h5><p>Each row shows charges, cumulative payment and balance after that visit.</p></div>
      <button class="btn btn-primary btn-sm" id="addVisitBtn"><i class="bi bi-plus-lg me-1"></i>Add visit</button>
    </div>

    <div class="table-responsive border rounded-3">
      <table class="table table-hover align-middle visit-table">
        <thead><tr><th>Visit</th><th>Charges this visit</th><th>Payment</th><th>Paid till visit</th><th>Total bill till visit</th><th>Balance after visit</th><th></th></tr></thead>
        <tbody>${renderVisitRows(p,visits)}</tbody>
      </table>
    </div>

    <div class="logic-note mt-3"><i class="bi bi-check-circle me-1"></i><b>Billing logic:</b> estimated bill = consultation + IOPA + treatment cost. Visit charges are added when recorded. Payment is the actual amount received. Balance is recalculated after every visit.</div>

    <div class="row g-3 mt-3">
      <div class="col-md-6"><div class="card-clean p-3"><b>Specialization</b><p class="mb-0 mt-1">${esc(p.specialization||"—")}</p></div></div>
      <div class="col-md-6"><div class="card-clean p-3"><b>Tooth number / Area to be treated</b><p class="mb-0 mt-1">${esc(p.toothArea||"—")}</p></div></div>
      <div class="col-md-6"><div class="card-clean p-3"><b>Treatment plan</b><p class="mb-0 mt-1">${esc(p.treatmentPlan||"—")}</p></div></div>
      <div class="col-md-6"><div class="card-clean p-3"><b>Prescription</b><p class="mb-0 mt-1 pre-wrap">${esc(p.prescription||"—")}</p></div></div>
      <div class="col-md-4"><div class="card-clean p-3"><b>Appointment status</b><p class="mb-0 mt-2"><span class="status ${esc(p.appointmentStatus||"pending")}">${esc(p.appointmentStatus||"pending")}</span></p></div></div>
      <div class="col-md-4"><div class="card-clean p-3"><b>Next appointment</b><p class="mb-0 mt-1">${p.nextAppointment?friendlyDate(p.nextAppointment):"Not scheduled"}${p.nextAppointmentTime?` · ${esc(p.nextAppointmentTime)}`:""}</p></div></div>
      <div class="col-md-4"><div class="card-clean p-3"><b>Recall</b><p class="mb-0 mt-1">${friendlyDate(p.recallDate)} · <span class="status ${esc(p.recallStatus)}">${esc(p.recallStatus)}</span></p></div></div>
    </div>`;

  document.getElementById("editPatientBtn").onclick=()=>{detailModal.hide();openPatientModal(p.id);};
  document.getElementById("deletePatientBtn").onclick=()=>deletePatient(p.id);
  document.getElementById("addVisitBtn").onclick=()=>{detailModal.hide(); setTimeout(()=>openVisitModal(null,p.id),150);};
  document.querySelectorAll(".edit-visit").forEach(b=>b.onclick=()=>{detailModal.hide(); setTimeout(()=>openVisitModal(b.dataset.id,p.id),150);});
  document.querySelectorAll(".delete-visit").forEach(b=>b.onclick=()=>deleteVisit(b.dataset.id,p.id));
}
function renderVisitRows(p,visits){
  if(!visits.length) return `<tr><td colspan="7"><div class="empty"><i class="bi bi-calendar2-x"></i><b>No visits recorded yet</b><span>Add the first consultation, IOPA, treatment payment and any additional charge.</span></div></td></tr>`;
  let priorCharges=0, paidTill=num(p.initialPaidAmount);
  return visits.map(v=>{
    const charge=num(v.consultationCharge)+num(v.iopaCharge)+num(v.additionalCharge);
    priorCharges+=charge;
    paidTill+=num(v.paymentAmount);
    const totalTill=getEstimatedBill(p)+priorCharges;
    const bal=totalTill-paidTill;
    return `<tr>
      <td><b>${friendlyDate(v.visitDate)}</b><small>${esc(v.treatmentDone||"No treatment note")}</small></td>
      <td><b>${money(charge)}</b><small>Consult ${money(v.consultationCharge)} · IOPA ${money(v.iopaCharge)}${v.additionalCharge?` · Additional ${money(v.additionalCharge)}`:""}</small>${v.additionalChargeNote?`<small><em>${esc(v.additionalChargeNote)}</em></small>`:""}</td>
      <td class="paid"><b>${money(v.paymentAmount)}</b><small>${esc(v.paymentMethod)}</small></td>
      <td>${money(paidTill)}</td><td>${money(totalTill)}</td><td class="${bal>0?'balance':''}">${money(bal)}</td>
      <td><div class="d-flex gap-1"><button class="btn btn-sm btn-light edit-visit" data-id="${v.id}" title="Edit"><i class="bi bi-pencil"></i></button><button class="btn btn-sm btn-light text-danger delete-visit" data-id="${v.id}" title="Delete"><i class="bi bi-trash"></i></button></div></td>
    </tr>`;
  }).join("");
}

function deletePatient(id){
  const p=state.patients.find(x=>x.id===id);
  if(!p||!confirmDelete(`Delete ${p.name} and all its visit records?`))return;
  state.patients=state.patients.filter(x=>x.id!==id);
  state.visits=state.visits.filter(v=>v.patientId!==id);
  saveDB().then(()=>{detailModal.hide();renderApp();toast("Patient deleted.");}).catch(()=>alert("Patient deleted locally, but the database could not be reached."));
}

/* ---------- Visit CRUD ---------- */
function openVisitModal(id,patientId){
  state.selectedId=patientId;state.editingVisitId=id;
  const p=state.patients.find(x=>x.id===patientId);
  const v=id?state.visits.find(x=>x.id===id):null;
  document.getElementById("visitModalTitle").textContent=v?"Edit visit & charges":"Add visit & payment";
  document.getElementById("visitPatientName").textContent=p?`For ${p.name}`:"";
  document.getElementById("visitId").value=id||"";
  document.getElementById("vDate").value=v?.visitDate||today();
  document.getElementById("vConsult").value=v?.consultationCharge??"";
  document.getElementById("vIopa").value=v?.iopaCharge??"";
  document.getElementById("vAdditional").value=v?.additionalCharge??"";
  document.getElementById("vAdditionalNote").value=v?.additionalChargeNote||"";
  document.getElementById("vPayment").value=v?.paymentAmount??"";
  document.getElementById("vMethod").value=v?.paymentMethod||"UPI";
  document.getElementById("vTreatment").value=v?.treatmentDone||"";
  document.getElementById("vNotes").value=v?.notes||"";
  document.getElementById("saveVisitBtn").textContent=v?"Save billing changes":"Save visit & payment";
  updateOutstanding();
  visitModal.show();
}
["vConsult","vIopa","vAdditional","vPayment"].forEach(id=>document.getElementById(id).addEventListener("input",updateOutstanding));

function updateOutstanding(){
  const p=state.patients.find(x=>x.id===state.selectedId);
  if(!p)return;
  const currentId=state.editingVisitId;
  const existing=state.visits.filter(v=>v.patientId===p.id && v.id!==currentId);
  const charges=existing.reduce((s,v)=>s+num(v.consultationCharge)+num(v.iopaCharge)+num(v.additionalCharge),0);
  const paid=num(p.initialPaidAmount)+existing.reduce((s,v)=>s+num(v.paymentAmount),0);
  const currentCharge=num(document.getElementById("vConsult").value)+num(document.getElementById("vIopa").value)+num(document.getElementById("vAdditional").value);
  const currentPayment=num(document.getElementById("vPayment").value);
  const outstanding=getEstimatedBill(p)+charges+currentCharge-paid-currentPayment;
  document.getElementById("visitOutstanding").textContent=money(outstanding);
}
document.getElementById("visitForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const p=state.patients.find(x=>x.id===state.selectedId);
  if(!p)return;
  const currentId=state.editingVisitId;
  const existing=state.visits.filter(v=>v.patientId===p.id && v.id!==currentId);
  const existingCharges=existing.reduce((s,v)=>s+num(v.consultationCharge)+num(v.iopaCharge)+num(v.additionalCharge),0);
  const existingPaid=num(p.initialPaidAmount)+existing.reduce((s,v)=>s+num(v.paymentAmount),0);
  const currentCharge=num(document.getElementById("vConsult").value)+num(document.getElementById("vIopa").value)+num(document.getElementById("vAdditional").value);
  const payment=num(document.getElementById("vPayment").value);
  const outstandingBeforePayment=getEstimatedBill(p)+existingCharges+currentCharge-existingPaid;
  if(payment>outstandingBeforePayment){
    alert(`Payment cannot exceed the outstanding balance for this visit (${money(outstandingBeforePayment)}).`);
    return;
  }
  const data={
    patientId:p.id,
    visitDate:document.getElementById("vDate").value,
    consultationCharge:num(document.getElementById("vConsult").value),
    iopaCharge:num(document.getElementById("vIopa").value),
    additionalCharge:num(document.getElementById("vAdditional").value),
    additionalChargeNote:document.getElementById("vAdditionalNote").value.trim(),
    paymentAmount:payment,
    paymentMethod:document.getElementById("vMethod").value,
    treatmentDone:document.getElementById("vTreatment").value.trim(),
    notes:document.getElementById("vNotes").value.trim()
  };
  if(currentId){
    const i=state.visits.findIndex(v=>v.id===currentId);
    if(i>=0)state.visits[i]={...state.visits[i],...data};
    toast("Visit and billing updated.");
  }else{
    state.visits.push({id:uid("v"),...data,createdAt:new Date().toISOString()});
    toast("Visit added and balance recalculated.");
  }
  try{
    await saveDB();
    visitModal.hide();
    renderDetail();
    renderMetrics();
    renderPatients();
  }catch(error){ alert("Visit saved locally, but the database could not be reached."); }
});
function deleteVisit(id,patientId){
  if(!confirmDelete("Delete this visit and recalculate the billing timeline?"))return;
  state.visits=state.visits.filter(v=>v.id!==id);
  saveDB();toast("Visit deleted and billing recalculated.");renderDetail();renderMetrics();renderPatients();
}

/* ---------- CSV Export ---------- */
function csvCell(v){return `"${String(v??"").replace(/"/g,'""')}"`;}
function exportCSV(){
  const headers=["Patient Name","Phone","Age","Gender","First Consultation","Recall Date","Recall Status","Appointment Status","Next Appointment","Next Appointment Time","Diagnosis","Specialization","Tooth Number / Area to be Treated","Treatment Plan","Prescription","Initial Visit Paid","Estimated Consultation","Estimated IOPA","Treatment Cost","Estimated Bill","Visit Charges","Total Bill","Paid","Balance"];
  const rows=[headers,...state.patients.map(p=>{
    const b=billing(p);
    return [p.name,p.phone,p.age,p.gender,p.firstConsultationDate,p.recallDate,p.recallStatus,p.appointmentStatus||"pending",p.nextAppointment||"",p.nextAppointmentTime||"",p.diagnosis,p.specialization||"",p.toothArea||"",p.treatmentPlan,p.prescription||"",p.initialPaidAmount||0,p.estimatedConsultationCharge||0,p.estimatedIopaCharge||0,p.treatmentCost??p.treatmentEstimate??0,getEstimatedBill(p),b.visitCharges,b.totalBill,b.paidAmount,b.balance];
  })];
  const csv=rows.map(r=>r.map(csvCell).join(",")).join("\n");
  const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="dentrecall-patients.csv";a.click();URL.revokeObjectURL(a.href);
  toast("CSV exported.");
}

/* ---------- Start ---------- */
if(isLoggedIn()){renderApp();}else{renderAuth();}

// ════════════════════════════════════════════════
// Extracted from the original monolithic interview.js during Phase 0
// architecture cleanup. Still classic global-scope scripts (no ES
// modules / bundler introduced) — order of <script> tags in
// interview.html matters and must match the order below:
//   state.js -> setup.js -> media.js -> speech.js -> conversation.js -> recording.js
// ════════════════════════════════════════════════

function selectSector(sector) {
    selectedSector = sector;
    document.getElementById('stepSector').style.display = 'none';
    
    if (sector === 'private') {
      document.getElementById('stepPrivate').style.display = 'block';
    } else {
      document.getElementById('stepGovernment').style.display = 'block';
    }
  }
  
  function goBackToSector() {
    selectedSector = null;
    document.getElementById('stepPrivate').style.display = 'none';
    document.getElementById('stepGovernment').style.display = 'none';
    document.getElementById('stepSector').style.display = 'block';
    
    // Reset
    biodataText = '';
    biodataFileName = '';
    biodataFileSize = 0;
    biodataSource = null;
  
    jdText = '';
    jdFileName = '';
    jdFileSize = 0;
    jdSource = null;
    const jdTextInput = document.getElementById('jdTextInput');
    if (jdTextInput) jdTextInput.value = '';
    const jdFileInput = document.getElementById('jdFileInput');
    if (jdFileInput) jdFileInput.value = '';
    ['jdPasteOption','jdUploadOption'].forEach(id => document.getElementById(id)?.classList.remove('selected'));
    const jdPasteSection = document.getElementById('jdPasteSection');
    const jdUploadSection = document.getElementById('jdUploadSection');
    if (jdPasteSection) jdPasteSection.style.display = 'none';
    if (jdUploadSection) jdUploadSection.style.display = 'none';
    const jdUploadedInfo = document.getElementById('jdUploadedInfo');
    if (jdUploadedInfo) jdUploadedInfo.style.display = 'none';
  
    const targetCompanyInput = document.getElementById('targetCompany');
    if (targetCompanyInput) targetCompanyInput.value = '';
  
    const interviewRoundSelect = document.getElementById('interviewRound');
    if (interviewRoundSelect) interviewRoundSelect.value = 'mixed';
  }
  
  // Optional — private sector only. Read directly from the DOM, same
  // pattern as getPrivateJobDomain/getPrivateJobRole above.
  function getTargetCompany() {
    const el = document.getElementById('targetCompany');
    return el ? el.value.trim() : '';
  }
  
  // Private sector only. Defaults to 'mixed' (current, already-tested
  // behavior) if the element is missing for any reason.
  function getInterviewRound() {
    const el = document.getElementById('interviewRound');
    return el ? el.value : 'mixed';
  }
  
  // ════════════════════════════════════════════════
  // JOB DOMAIN/ROLE SELECTION
  // ════════════════════════════════════════════════
  function updatePrivateRoles() {
    const domain = document.getElementById('privateDomain').value;
    const roleSelect = document.getElementById('privateRole');
    const roleGroup = document.getElementById('privateRoleGroup');
    const domainCustomGroup = document.getElementById('privateDomainCustomGroup');
    const roleCustomGroup = document.getElementById('privateRoleCustomGroup');
  
    if (domain === 'other') {
      // Fully custom domain — role also has to be typed, no predefined list applies
      domainCustomGroup.style.display = 'block';
      roleGroup.style.display = 'none';
      roleCustomGroup.style.display = 'block';
      return;
    }
    domainCustomGroup.style.display = 'none';
  
    if (domain) {
      roleGroup.style.display = 'block';
      roleSelect.innerHTML = '<option value="">Select a role</option>';
      privateDomains[domain].forEach(role => {
        roleSelect.innerHTML += `<option value="${role}">${role}</option>`;
      });
      roleSelect.innerHTML += `<option value="__other__">Other (specify below)</option>`;
      roleCustomGroup.style.display = 'none';
    } else {
      roleGroup.style.display = 'none';
      roleCustomGroup.style.display = 'none';
    }
  }
  
  function togglePrivateRoleCustom() {
    const roleCustomGroup = document.getElementById('privateRoleCustomGroup');
    roleCustomGroup.style.display = document.getElementById('privateRole').value === '__other__' ? 'block' : 'none';
  }
  
  // Resolves the final job domain/role, whether picked from the dropdown or typed as custom
  function getPrivateJobDomain() {
    const domainSelect = document.getElementById('privateDomain');
    if (domainSelect.value === 'other') return document.getElementById('privateDomainCustom').value.trim();
    if (!domainSelect.value) return '';
    return domainSelect.options[domainSelect.selectedIndex].text; // human-readable label, e.g. "HR & Management"
  }
  
  function getPrivateJobRole() {
    const domain = document.getElementById('privateDomain').value;
    if (domain === 'other') return document.getElementById('privateRoleCustom').value.trim();
    const roleVal = document.getElementById('privateRole').value;
    if (roleVal === '__other__') return document.getElementById('privateRoleCustom').value.trim();
    return roleVal;
  }
  
  function updateGovernmentRoles() {
    const domain = document.getElementById('governmentDomain').value;
    const roleSelect = document.getElementById('governmentRole');
    const roleGroup = document.getElementById('governmentRoleGroup');
    
    if (domain) {
      roleGroup.style.display = 'block';
      roleSelect.innerHTML = '<option value="">Select a role</option>';
      governmentDomains[domain].forEach(role => {
        roleSelect.innerHTML += `<option value="${role}">${role}</option>`;
      });
    } else {
      roleGroup.style.display = 'none';
    }
  }
  
  // ════════════════════════════════════════════════
  // BIODATA OPTIONS
  // ════════════════════════════════════════════════
  function selectBiodataOption(option) {
    biodataSource = option;
    
    document.getElementById('biodataUploadOption').classList.remove('selected');
    document.getElementById('biodataFormOption').classList.remove('selected');
    
    if (option === 'upload') {
      document.getElementById('biodataUploadOption').classList.add('selected');
      document.getElementById('biodataUploadSection').style.display = 'block';
      document.getElementById('biodataFormSection').style.display = 'none';
    } else {
      document.getElementById('biodataFormOption').classList.add('selected');
      document.getElementById('biodataFormSection').style.display = 'block';
      document.getElementById('biodataUploadSection').style.display = 'none';
    }
  }
  
  // ════════════════════════════════════════════════
  // JOB DESCRIPTION (JD) OPTIONS — PRIVATE SECTOR, OPTIONAL
  // ════════════════════════════════════════════════
  function selectJdOption(option) {
    jdSource = option;
  
    document.getElementById('jdPasteOption').classList.remove('selected');
    document.getElementById('jdUploadOption').classList.remove('selected');
  
    if (option === 'paste') {
      document.getElementById('jdPasteOption').classList.add('selected');
      document.getElementById('jdPasteSection').style.display = 'block';
      document.getElementById('jdUploadSection').style.display = 'none';
    } else {
      document.getElementById('jdUploadOption').classList.add('selected');
      document.getElementById('jdUploadSection').style.display = 'block';
      document.getElementById('jdPasteSection').style.display = 'none';
    }
  }
  
  function handleJdTextInput(event) {
    jdText = event.target.value;
  }
  
  function handleJdUpload(event) {
    const file = event.target.files[0];
    if (file) processJdFile(file);
  }
  
  async function processJdFile(file) {
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) { showSetupError('JD file is too large (max 5 MB)'); return; }
  
    const allowed = ['application/pdf', 'text/plain', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowed.includes(file.type) && !file.name.match(/\.(pdf|txt|doc|docx)$/i)) {
      showSetupError('Unsupported file type. Use PDF, TXT, or DOC/DOCX.'); return;
    }
  
    jdFileName = file.name;
    jdFileSize = file.size;
    jdText = '';
  
    document.getElementById('jdParsingIndicator').style.display = 'flex';
    document.getElementById('jdParsingStatusText').textContent = 'Reading the job description…';
    document.getElementById('jdUploadedInfo').style.display = 'none';
  
    try {
      if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
        jdText = await file.text();
      } else if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        jdText = await extractPdfText(file, 'jdParsingStatusText');
      } else {
        jdText = await extractDocxText(file);
      }
  
      if (!jdText || jdText.trim().length < 20) {
        showSetupError('Could not extract text from the JD. Try a PDF or TXT version.');
        document.getElementById('jdParsingIndicator').style.display = 'none';
        return;
      }
      showJdUploaded();
    } catch (err) {
      console.error('JD parsing error:', err);
      const msg = err && err.message === 'legacy_doc_unsupported'
        ? 'Old .doc format is not supported. Please upload a .docx, PDF, or TXT file.'
        : 'Failed to read the file. Please try a PDF, DOCX, or TXT.';
      showSetupError(msg);
      document.getElementById('jdParsingIndicator').style.display = 'none';
    }
  }
  
  function showJdUploaded() {
    document.getElementById('jdParsingIndicator').style.display = 'none';
    const sizeLabel = jdFileSize < 1024 * 1024
      ? `${(jdFileSize / 1024).toFixed(1)} KB`
      : `${(jdFileSize / (1024 * 1024)).toFixed(1)} MB`;
    const info = document.getElementById('jdUploadedInfo');
    info.style.display = 'block';
    info.innerHTML = `
      <div class="resume-uploaded">
        <div class="resume-uploaded-icon">✅</div>
        <div class="resume-uploaded-info">
          <div class="resume-uploaded-name">📋 ${escapeHtml(jdFileName)}</div>
          <div class="resume-uploaded-size">${sizeLabel} · ${jdText.trim().split(/\s+/).length.toLocaleString()} words extracted</div>
        </div>
        <button class="resume-remove-btn" onclick="removeJd()">Remove</button>
      </div>`;
  }
  
  function removeJd() {
    jdText = '';
    jdFileName = '';
    jdFileSize = 0;
    document.getElementById('jdFileInput').value = '';
    document.getElementById('jdUploadedInfo').style.display = 'none';
  }
  
  // ════════════════════════════════════════════════
  // BIODATA UPLOAD & PARSING
  // ════════════════════════════════════════════════
  document.addEventListener('DOMContentLoaded', () => {
    // Warn upfront if this browser/device can't do voice input at all, so the
    // candidate isn't left confused mid-interview wondering why the mic never
    // picks anything up. Typing still works either way.
    const SRCheck = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SRCheck) {
      const notice = document.createElement('div');
      notice.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:100000;background:linear-gradient(135deg,#f59e0b,#ef4444);color:#fff;text-align:center;padding:0.6rem 1rem;font-size:0.85rem;font-weight:600;';
      notice.textContent = "⚠️ Voice input isn't supported on this browser/device — you can still type your answers. For voice input, use Chrome or Edge on desktop or Android.";
      document.body.prepend(notice);
    }
  
    // Resume drop zone for private sector
    const resumeZone = document.getElementById('resumeDropZone');
    if (resumeZone) {
      resumeZone.addEventListener('dragover', e => { e.preventDefault(); resumeZone.classList.add('drag-over'); });
      resumeZone.addEventListener('dragleave', () => resumeZone.classList.remove('drag-over'));
      resumeZone.addEventListener('drop', e => {
        e.preventDefault(); resumeZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) processResumeFile(file);
      });
    }
  
    // JD drop zone for private sector (optional)
    const jdZone = document.getElementById('jdDropZone');
    if (jdZone) {
      jdZone.addEventListener('dragover', e => { e.preventDefault(); jdZone.classList.add('drag-over'); });
      jdZone.addEventListener('dragleave', () => jdZone.classList.remove('drag-over'));
      jdZone.addEventListener('drop', e => {
        e.preventDefault(); jdZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) processJdFile(file);
      });
    }
  
    // Biodata drop zone for government sector
    const biodataZone = document.getElementById('biodataDropZone');
    if (biodataZone) {
      biodataZone.addEventListener('dragover', e => { e.preventDefault(); biodataZone.classList.add('drag-over'); });
      biodataZone.addEventListener('dragleave', () => biodataZone.classList.remove('drag-over'));
      biodataZone.addEventListener('drop', e => {
        e.preventDefault(); biodataZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) processBiodataFile(file);
      });
    }
  
    // Character counter for candidate summary
    const summaryTextarea = document.getElementById('candidateSummary');
    if (summaryTextarea) {
      summaryTextarea.addEventListener('input', () => {
        const count = summaryTextarea.value.length;
        document.getElementById('charCounter').textContent = `${count}/1000`;
      });
    }
  });
  
  function handleBiodataUpload(event) {
    const file = event.target.files[0];
    if (file) processBiodataFile(file);
  }
  
  async function processBiodataFile(file) {
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) { showSetupErrorGov('File is too large (max 5 MB)'); return; }
  
    const allowed = ['application/pdf', 'text/plain', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowed.includes(file.type) && !file.name.match(/\.(pdf|txt|doc|docx)$/i)) {
      showSetupErrorGov('Unsupported file type. Use PDF, TXT, or DOC/DOCX.'); return;
    }
  
    biodataFileName = file.name;
    biodataFileSize = file.size;
    biodataText = '';
  
    document.getElementById('biodataParsingIndicator').style.display = 'flex';
    document.getElementById('biodataParsingStatusText').textContent = 'Reading your biodata…';
    document.getElementById('biodataUploadedInfo').style.display = 'none';
  
    try {
      if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
        biodataText = await file.text();
      } else if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        biodataText = await extractPdfText(file, 'biodataParsingStatusText');
      } else {
        biodataText = await extractDocxText(file);
      }
  
      if (!biodataText || biodataText.trim().length < 30) {
        showSetupErrorGov('Could not extract text. Try a PDF or TXT version.');
        document.getElementById('biodataParsingIndicator').style.display = 'none';
        return;
      }
      showBiodataUploaded();
    } catch (err) {
      console.error('Biodata parsing error:', err);
      const msg = err && err.message === 'legacy_doc_unsupported'
        ? 'Old .doc format is not supported. Please upload a .docx, PDF, or TXT file.'
        : 'Failed to read the file. Please try a PDF, DOCX, or TXT.';
      showSetupErrorGov(msg);
      document.getElementById('biodataParsingIndicator').style.display = 'none';
    }
  }
  
  function showBiodataUploaded() {
    document.getElementById('biodataParsingIndicator').style.display = 'none';
    const sizeLabel = biodataFileSize < 1024 * 1024
      ? `${(biodataFileSize / 1024).toFixed(1)} KB`
      : `${(biodataFileSize / (1024 * 1024)).toFixed(1)} MB`;
    const info = document.getElementById('biodataUploadedInfo');
    info.style.display = 'block';
    info.innerHTML = `
      <div class="resume-uploaded">
        <div class="resume-uploaded-icon">✅</div>
        <div class="resume-uploaded-info">
          <div class="resume-uploaded-name">📄 ${escapeHtml(biodataFileName)}</div>
          <div class="resume-uploaded-size">${sizeLabel} · ${biodataText.trim().split(/\s+/).length.toLocaleString()} words extracted</div>
        </div>
        <button class="resume-remove-btn" onclick="removeBiodata()">Remove</button>
      </div>`;
  }
  
  function removeBiodata() {
    biodataText = '';
    biodataFileName = '';
    biodataFileSize = 0;
    document.getElementById('biodataFileInput').value = '';
    document.getElementById('biodataUploadedInfo').style.display = 'none';
  }
  
  // ════════════════════════════════════════════════
  // DYNAMIC FORM ITEMS (EDUCATION, EXAM, EXPERIENCE)
  // ════════════════════════════════════════════════
  let entryIdCounter = 0;
  
  function addEducation() {
    const id = entryIdCounter++;
    educationEntries.push(id);
    const list = document.getElementById('educationList');
    const div = document.createElement('div');
    div.className = 'dynamic-item';
    div.id = `edu-${id}`;
    div.innerHTML = `
      <input type="text" class="form-input" placeholder="Qualification (e.g. B.Tech)">
      <input type="text" class="form-input" placeholder="Board/University">
      <input type="text" class="form-input" placeholder="Institute">
      <input type="text" class="form-input" placeholder="Passing Year">
      <input type="text" class="form-input" placeholder="Percentage/CGPA">
      <button class="remove-btn" onclick="removeEducation(${id})">Remove</button>
    `;
    list.appendChild(div);
  }
  
  function removeEducation(id) {
    const index = educationEntries.indexOf(id);
    if (index > -1) educationEntries.splice(index, 1);
    document.getElementById(`edu-${id}`).remove();
  }
  
  function addCompetitiveExam() {
    const id = entryIdCounter++;
    examEntries.push(id);
    const list = document.getElementById('competitiveExamList');
    const div = document.createElement('div');
    div.className = 'dynamic-item';
    div.id = `exam-${id}`;
    div.innerHTML = `
      <input type="text" class="form-input" placeholder="Exam Name">
      <input type="text" class="form-input" placeholder="Year">
      <input type="text" class="form-input" placeholder="Number of Attempts">
      <input type="text" class="form-input" placeholder="Marks">
      <input type="text" class="form-input" placeholder="Rank (Optional)">
      <button class="remove-btn" onclick="removeExam(${id})">Remove</button>
    `;
    list.appendChild(div);
  }
  
  function removeExam(id) {
    const index = examEntries.indexOf(id);
    if (index > -1) examEntries.splice(index, 1);
    document.getElementById(`exam-${id}`).remove();
  }
  
  function addExperience() {
    const id = entryIdCounter++;
    experienceEntries.push(id);
    const list = document.getElementById('experienceList');
    const div = document.createElement('div');
    div.className = 'dynamic-item';
    div.id = `exp-${id}`;
    div.innerHTML = `
      <input type="text" class="form-input" placeholder="Company Name">
      <input type="text" class="form-input" placeholder="Position">
      <input type="text" class="form-input" placeholder="Duration (e.g. 2020-2023)">
      <button class="remove-btn" onclick="removeExperience(${id})">Remove</button>
    `;
    list.appendChild(div);
  }
  
  function removeExperience(id) {
    const index = experienceEntries.indexOf(id);
    if (index > -1) experienceEntries.splice(index, 1);
    document.getElementById(`exp-${id}`).remove();
  }
  
  // ════════════════════════════════════════════════
  // COLLECT BIODATA FROM FORM
  // ════════════════════════════════════════════════
  function collectBiodataFromForm() {
    const data = {
      personal: {
        fullName: document.getElementById('bioFullName').value,
        fatherName: document.getElementById('bioFatherName').value,
        motherName: document.getElementById('bioMotherName').value,
        dob: document.getElementById('bioDOB').value,
        gender: document.getElementById('bioGender').value,
        category: document.getElementById('bioCategory').value,
        nationality: document.getElementById('bioNationality').value,
        maritalStatus: document.getElementById('bioMaritalStatus').value
      },
      contact: {
        mobile: document.getElementById('bioMobile').value,
        email: document.getElementById('bioEmail').value,
        address: document.getElementById('bioAddress').value,
        state: document.getElementById('bioState').value,
        district: document.getElementById('bioDistrict').value,
        pincode: document.getElementById('bioPincode').value
      },
      education: [],
      competitiveExams: [],
      skills: {
        computerSkills: document.getElementById('bioComputerSkills').value,
        typingSpeed: document.getElementById('bioTypingSpeed').value,
        languages: document.getElementById('bioLanguages').value,
        technicalSkills: document.getElementById('bioTechnicalSkills').value
      },
      experience: [],
      achievements: document.getElementById('bioAchievements').value,
      hobbies: document.getElementById('bioHobbies').value
    };
  
    // Collect education
    educationEntries.forEach(id => {
      const div = document.getElementById(`edu-${id}`);
      if (!div) return;
      const inputs = div.querySelectorAll('input');
      data.education.push({
        qualification: inputs[0].value,
        boardUniversity: inputs[1].value,
        institute: inputs[2].value,
        passingYear: inputs[3].value,
        percentage: inputs[4].value
      });
    });
  
    // Collect competitive exams
    examEntries.forEach(id => {
      const div = document.getElementById(`exam-${id}`);
      if (!div) return;
      const inputs = div.querySelectorAll('input');
      data.competitiveExams.push({
        examName: inputs[0].value,
        year: inputs[1].value,
        attempts: inputs[2].value,
        marks: inputs[3].value,
        rank: inputs[4].value
      });
    });
  
    // Collect experience
    experienceEntries.forEach(id => {
      const div = document.getElementById(`exp-${id}`);
      if (!div) return;
      const inputs = div.querySelectorAll('input');
      data.experience.push({
        company: inputs[0].value,
        position: inputs[1].value,
        duration: inputs[2].value
      });
    });
  
    return JSON.stringify(data, null, 2);
  }
  
  // ════════════════════════════════════════════════
  // RESUME UPLOAD & PARSING (PRIVATE SECTOR)
  // ════════════════════════════════════════════════
  function handleResumeUpload(event) {
    const file = event.target.files[0];
    if (file) processResumeFile(file);
  }
  
  async function processResumeFile(file) {
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) { showSetupError('File is too large (max 5 MB)'); return; }
  
    const allowed = ['application/pdf', 'text/plain', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowed.includes(file.type) && !file.name.match(/\.(pdf|txt|doc|docx)$/i)) {
      showSetupError('Unsupported file type. Use PDF, TXT, or DOC/DOCX.'); return;
    }
  
    resumeFileName = file.name;
    resumeFileSize = file.size;
    resumeText = '';
  
    document.getElementById('resumeParsingIndicator').style.display = 'flex';
    document.getElementById('resumeParsingStatusText').textContent = 'Reading your resume…';
    document.getElementById('resumeUploadedInfo').style.display = 'none';
  
    try {
      if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
        resumeText = await file.text();
      } else if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        resumeText = await extractPdfText(file, 'resumeParsingStatusText');
      } else {
        resumeText = await extractDocxText(file);
      }
  
      if (!resumeText || resumeText.trim().length < 30) {
        showSetupError('Could not extract text. Try a PDF or TXT version.');
        document.getElementById('resumeParsingIndicator').style.display = 'none';
        return;
      }
      showResumeUploaded();
    } catch (err) {
      console.error('Resume parsing error:', err);
      const msg = err && err.message === 'legacy_doc_unsupported'
        ? 'Old .doc format is not supported. Please upload a .docx, PDF, or TXT file.'
        : 'Failed to read the file. Please try a PDF, DOCX, or TXT.';
      showSetupError(msg);
      document.getElementById('resumeParsingIndicator').style.display = 'none';
    }
  }
  
  async function extractPdfText(file, statusElId) {
    if (!window.pdfjsLib) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + '\n';
    }
  
    // If pdf.js found a real embedded text layer, we're done — this is
    // the fast path and covers the vast majority of resumes.
    if (text.trim().length >= 30) {
      return text;
    }
  
    // No usable text layer — this is the case that was breaking for
    // scanned resumes and heavily-designed PDFs (Canva/Illustrator/some
    // Acrobat exports), where the "text" on the page is actually pixels,
    // not real text objects. Fall back to OCR: render each page to a
    // canvas image and read it with Tesseract.
    if (statusElId) {
      const el = document.getElementById(statusElId);
      if (el) el.textContent = 'No text layer found — reading it as an image (this can take up to a minute)…';
    }
  
    if (!window.Tesseract) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.4/tesseract.min.js');
    }
  
    let ocrText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      // Higher scale = sharper render = more accurate OCR, at the cost of
      // speed. 2x is a reasonable balance for a resume-length document.
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  
      if (statusElId) {
        const el = document.getElementById(statusElId);
        if (el) el.textContent = `Reading page ${i} of ${pdf.numPages} with OCR…`;
      }
  
      const { data } = await window.Tesseract.recognize(canvas, 'eng');
      ocrText += (data.text || '') + '\n';
    }
  
    return ocrText;
  }
  
  async function extractDocxText(file) {
    // .doc (legacy binary Word format) can't be parsed in-browser reliably —
    // ask the user for .docx/.pdf/.txt instead rather than silently returning garbage.
    if (file.name.toLowerCase().endsWith('.doc') && !file.name.toLowerCase().endsWith('.docx')) {
      throw new Error('legacy_doc_unsupported');
    }
  
    if (!window.mammoth) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.7.0/mammoth.browser.min.js');
    }
    const arrayBuffer = await file.arrayBuffer();
    const result = await window.mammoth.extractRawText({ arrayBuffer });
    return (result.value || '').trim();
  }
  
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  
  // Escapes a string before it's interpolated into innerHTML — needed anywhere
  // user-controlled text (like an uploaded file's name, which the browser
  // never sanitizes) gets rendered as HTML rather than set as textContent.
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  
  function showResumeUploaded() {
    document.getElementById('resumeParsingIndicator').style.display = 'none';
    const sizeLabel = resumeFileSize < 1024 * 1024
      ? `${(resumeFileSize / 1024).toFixed(1)} KB`
      : `${(resumeFileSize / (1024 * 1024)).toFixed(1)} MB`;
    const info = document.getElementById('resumeUploadedInfo');
    info.style.display = 'block';
    info.innerHTML = `
      <div class="resume-uploaded">
        <div class="resume-uploaded-icon">✅</div>
        <div class="resume-uploaded-info">
          <div class="resume-uploaded-name">📄 ${escapeHtml(resumeFileName)}</div>
          <div class="resume-uploaded-size">${sizeLabel} · ${resumeText.trim().split(/\s+/).length.toLocaleString()} words extracted</div>
        </div>
        <button class="resume-remove-btn" onclick="removeResume()">Remove</button>
      </div>`;
  }
  
  function removeResume() {
    resumeText = '';
    resumeFileName = '';
    resumeFileSize = 0;
    document.getElementById('resumeFileInput').value = '';
    document.getElementById('resumeUploadedInfo').style.display = 'none';
  }
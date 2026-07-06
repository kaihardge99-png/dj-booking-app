const STORAGE_KEY = 'local-invoice-generator-profile';
const SAVE_DIRECTORY_KEY = 'local-invoice-generator-save-directory';

const defaultState = {
  businessName: 'Your Business Name',
  businessEmail: 'billing@yourbusiness.com',
  businessPhone: '+61 400 123 456',
  businessTax: 'ABN 12 345 678 901',
  bankName: 'Commonwealth Bank',
  accountName: 'Your Business Name',
  bsbNumber: '063-000',
  accountNumber: '12345678',
  paymentTerms: 'Due within 7 days',
  clientName: 'Client Company',
  clientEmail: 'client@email.com',
  invoiceNumber: 'INV-001',
  invoiceDate: new Date().toISOString().slice(0, 10),
  dueDate: '',
  currency: 'AUD',
  referenceNumber: '',
  paymentMethod: 'Bank transfer',
  notes: 'Thank you for your business.',
  terms: 'Please pay within the stated terms.',
  items: [
    { description: 'Design work', qty: 1, price: 650 },
    { description: 'Development', qty: 1, price: 1200 },
  ],
};

const form = document.getElementById('invoiceForm');
const itemsList = document.getElementById('itemsList');
const preview = document.getElementById('invoicePreview');
const printBtn = document.getElementById('printBtn');
const resetBtn = document.getElementById('resetBtn');
const addItemBtn = document.getElementById('addItemBtn');
const presetItemSelect = document.getElementById('presetItemSelect');
const addPresetItemBtn = document.getElementById('addPresetItemBtn');
const statusMessage = document.getElementById('statusMessage');

let state = loadState();
let directoryHandle = null;

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return { ...defaultState };
    const parsed = JSON.parse(saved);
    return {
      ...defaultState,
      ...parsed,
      items: parsed.items?.length ? parsed.items : defaultState.items,
    };
  } catch (error) {
    return { ...defaultState };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function setStatus(message) {
  statusMessage.textContent = message;
}

function sanitizeFileName(value) {
  return String(value || 'invoice')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'invoice';
}

async function ensureSaveDirectory() {
  if (directoryHandle) return directoryHandle;

  const hasStoredChoice = localStorage.getItem(SAVE_DIRECTORY_KEY);
  if (hasStoredChoice && window.showDirectoryPicker) {
    try {
      directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      return directoryHandle;
    } catch (error) {
      setStatus('Folder selection cancelled.');
      return null;
    }
  }

  if (!window.showDirectoryPicker) {
    setStatus('This browser cannot save files directly. The PDF will download instead.');
    return null;
  }

  try {
    directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    localStorage.setItem(SAVE_DIRECTORY_KEY, '1');
    return directoryHandle;
  } catch (error) {
    setStatus('Folder selection cancelled.');
    return null;
  }
}

async function savePdfToFolder(pdfBlob, invoiceNumber) {
  const folderName = 'Invoice PDFs';
  const clientName = (state.clientName || 'client').trim();
  const fileName = `${sanitizeFileName(invoiceNumber || 'invoice')}-${sanitizeFileName(clientName)}.pdf`;
  const targetDirectory = await ensureSaveDirectory();

  if (!targetDirectory) {
    return null;
  }

  const invoiceFolder = await targetDirectory.getDirectoryHandle(folderName, { create: true });
  const fileHandle = await invoiceFolder.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(pdfBlob);
  await writable.close();
  return `${folderName}/${fileName}`;
}

async function generateAndSaveInvoice() {
  if (typeof window.html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
    setStatus('PDF libraries are still loading. Please refresh and try again.');
    return;
  }

  setStatus('Generating PDF...');

  try {
    const canvas = await window.html2canvas(preview, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
    });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 8;
    const imgWidth = pageWidth - margin * 2;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = margin;

    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, position, imgWidth, imgHeight);
    heightLeft -= pageHeight - margin * 2;

    while (heightLeft > 0) {
      position = margin - imgHeight + heightLeft;
      pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, position, imgWidth, imgHeight);
      heightLeft -= pageHeight - margin * 2;
    }

    const pdfBlob = pdf.output('blob');
    const invoiceNumber = state.invoiceNumber;
    const savePath = await savePdfToFolder(pdfBlob, invoiceNumber);

    if (savePath) {
      startNewInvoice();
      setStatus(`PDF saved to ${savePath}. New invoice ready.`);
    } else {
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${sanitizeFileName(invoiceNumber || 'invoice')}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setStatus('Saved as a download because folder access was not available.');
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    console.error(error);
    setStatus('PDF generation failed. Please try again.');
  }
}

function populateForm() {
  for (const [name, value] of Object.entries(state)) {
    if (name === 'items') continue;
    const field = form.elements.namedItem(name);
    if (field) field.value = value;
  }
  renderItems();
  renderPreview();
}

function updateStateFromForm() {
  const data = new FormData(form);
  state = {
    ...state,
    businessName: data.get('businessName') || '',
    businessEmail: data.get('businessEmail') || '',
    businessPhone: data.get('businessPhone') || '',
    businessTax: data.get('businessTax') || '',
    bankName: data.get('bankName') || '',
    accountName: data.get('accountName') || '',
    bsbNumber: data.get('bsbNumber') || '',
    accountNumber: data.get('accountNumber') || '',
    paymentTerms: data.get('paymentTerms') || '',
    paymentMethod: data.get('paymentMethod') || '',
    clientName: data.get('clientName') || '',
    clientEmail: data.get('clientEmail') || '',
    invoiceNumber: data.get('invoiceNumber') || '',
    invoiceDate: data.get('invoiceDate') || '',
    dueDate: data.get('dueDate') || '',
    currency: 'AUD',
    referenceNumber: data.get('referenceNumber') || '',
    paymentMethod: data.get('paymentMethod') || '',
    notes: data.get('notes') || '',
    terms: data.get('terms') || '',
  };
  saveState();
  renderPreview();
}

function renderItems() {
  itemsList.innerHTML = '';
  state.items.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-row">
        <label>
          Description
          <input type="text" data-index="${index}" data-field="description" value="${escapeHtml(item.description)}" />
        </label>
        <label>
          Qty
          <input type="number" min="1" step="1" data-index="${index}" data-field="qty" value="${item.qty}" />
        </label>
        <label>
          Price
          <input type="number" min="0" step="0.01" data-index="${index}" data-field="price" value="${item.price}" />
        </label>
      </div>
      <button type="button" class="secondary remove-btn" data-remove-index="${index}">Remove</button>
    `;
    itemsList.appendChild(card);
  });
}

function updateItem(index, field, value) {
  state.items[index] = {
    ...state.items[index],
    [field]: field === 'description' ? value : Number(value || 0),
  };
  saveState();
  renderPreview();
}

function addItem() {
  state.items.push({ description: '', qty: 1, price: 0 });
  saveState();
  renderItems();
  renderPreview();
}

function addPresetItem() {
  const description = presetItemSelect.value;
  if (!description) return;

  const price = description === 'DJ Practice booking Package 1 - 1 hr' ? 50 : description === 'DJ Practice booking Package 2 - 1 hr' ? 100 : 0;

  state.items.push({ description, qty: 1, price });
  saveState();
  renderItems();
  renderPreview();
  presetItemSelect.value = '';
}

function removeItem(index) {
  state.items.splice(index, 1);
  saveState();
  renderItems();
  renderPreview();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(value) {
  const currency = state.currency || 'AUD';
  const symbol = currency === 'AUD' ? '$' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '';
  const amount = Number(value || 0).toFixed(2);
  return `${symbol}${amount}${currency && !['AUD', 'USD', 'EUR'].includes(currency) ? ` ${currency}` : ''}`;
}

function getBusinessFields() {
  return {
    businessName: state.businessName || '',
    businessEmail: state.businessEmail || '',
    businessPhone: state.businessPhone || '',
    businessTax: state.businessTax || '',
    bankName: state.bankName || '',
    accountName: state.accountName || '',
    bsbNumber: state.bsbNumber || '',
    accountNumber: state.accountNumber || '',
    paymentTerms: state.paymentTerms || '',
    currency: state.currency || 'AUD',
    paymentMethod: state.paymentMethod || 'Bank transfer',
  };
}

function generateInvoiceNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = String(Math.floor(1000 + Math.random() * 9000)).padStart(4, '0');
  return `INV-${year}${month}${day}-${random}`;
}

function getNextInvoiceDate() {
  return new Date().toISOString().slice(0, 10);
}

function startNewInvoice() {
  const businessFields = getBusinessFields();
  state = {
    ...defaultState,
    ...businessFields,
    invoiceNumber: generateInvoiceNumber(),
    invoiceDate: getNextInvoiceDate(),
    dueDate: '',
    clientName: '',
    clientEmail: '',
    clientAddress: '',
    referenceNumber: '',
    paymentMethod: businessFields.paymentMethod || 'Bank transfer',
    notes: '',
    terms: '',
    items: [{ description: '', qty: 1, price: 0 }],
  };
  saveState();
  populateForm();
}

function renderPreview() {
  const subtotal = state.items.reduce((sum, item) => sum + item.qty * item.price, 0);
  const total = subtotal;

  const due = state.dueDate ? new Date(state.dueDate).toLocaleDateString() : '—';
  const issued = state.invoiceDate ? new Date(state.invoiceDate).toLocaleDateString() : '—';

  preview.innerHTML = `
    <div class="top">
      <div>
        <h3>${escapeHtml(state.businessName || 'Your business name')}</h3>
        <div class="muted">${escapeHtml(state.businessEmail || '')}</div>
        <div class="muted">${escapeHtml(state.businessPhone || '')}</div>
      </div>
      <div style="text-align:right;">
        <h3>Invoice</h3>
        <div class="muted"># ${escapeHtml(state.invoiceNumber || 'INV-001')}</div>
        <div class="muted">Issued: ${issued}</div>
        <div class="muted">Due: ${due}</div>
      </div>
    </div>

    <div class="top">
      <div>
        <div class="muted">Bill to</div>
        <strong>${escapeHtml(state.clientName || 'Client name')}</strong>
        <div class="muted">${escapeHtml(state.clientEmail || '')}</div>
      </div>
      <div style="text-align:right;">
        <div class="muted">ABN</div>
        <strong>${escapeHtml(state.businessTax || '—')}</strong>
        <div class="muted">${escapeHtml(state.referenceNumber || '')}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th>Qty</th>
          <th>Unit price</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        ${state.items.map((item) => `
          <tr>
            <td>${escapeHtml(item.description || 'Service')}</td>
            <td>${item.qty}</td>
            <td>${formatMoney(item.price)}</td>
            <td>${formatMoney(item.qty * item.price)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="summary">
      <div class="box">
        <div style="display:flex; justify-content:space-between; margin-bottom:0.35rem;">Subtotal <span>${formatMoney(subtotal)}</span></div>
        <div style="display:flex; justify-content:space-between; font-weight:700; font-size:1.02rem;">Total due <span>${formatMoney(total)}</span></div>
      </div>
    </div>

    <div style="margin-top:1rem;">
      <div><strong>Notes</strong></div>
      <div class="muted" style="white-space: pre-line;">${escapeHtml(state.notes || '')}</div>
    </div>

    <div style="margin-top:1rem;">
      <div><strong>Payment details</strong></div>
      <div class="muted">${escapeHtml(state.bankName || '')}</div>
      <div class="muted">${escapeHtml(state.accountName || '')}</div>
      <div class="muted">BSB: ${escapeHtml(state.bsbNumber || '')}</div>
      <div class="muted">Account Number: ${escapeHtml(state.accountNumber || '')}</div>
      <div style="margin-top:0.35rem;" class="muted">Payment Terms: ${escapeHtml(state.paymentTerms || '')}</div>
      <div class="muted">${escapeHtml(state.paymentMethod || '')}</div>
    </div>

    <div style="margin-top:1rem;">
      <div><strong>Terms</strong></div>
      <div class="muted" style="white-space: pre-line;">${escapeHtml(state.terms || '')}</div>
    </div>
  `;
}

form.addEventListener('input', updateStateFromForm);
form.addEventListener('change', updateStateFromForm);

itemsList.addEventListener('input', (event) => {
  const target = event.target;
  if (target.matches('input[data-field]')) {
    updateItem(Number(target.dataset.index), target.dataset.field, target.value);
  }
});

itemsList.addEventListener('click', (event) => {
  const target = event.target;
  if (target.matches('button[data-remove-index]')) {
    removeItem(Number(target.dataset.removeIndex));
  }
});

addItemBtn.addEventListener('click', addItem);
addPresetItemBtn.addEventListener('click', addPresetItem);
printBtn.addEventListener('click', generateAndSaveInvoice);
resetBtn.addEventListener('click', startNewInvoice);

populateForm();

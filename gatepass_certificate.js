const PDFDocument = require('pdfkit');

const INSTITUTION_NAME = 'HOSTELFIX STUDENT RESIDENCE';
const DOCUMENT_TITLE = 'Leave Authorization';

// Restrained institutional palette - designed for print as well as screen.
const COLOR = {
  navy: '#102A43',
  blue: '#1D4ED8',
  sky: '#EAF2FF',
  ink: '#172033',
  muted: '#607086',
  line: '#D9E2EC',
  wash: '#F7F9FC',
  white: '#FFFFFF',
  green: '#15803D',
  greenWash: '#ECFDF3',
  red: '#B42318',
  redWash: '#FEF3F2'
};

function formatDate(value) {
  if (!value) return 'Not specified';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return 'Not specified';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
  });
}

function isAuthorised(status) {
  return /approved|security_pending|outside|completed|warden_pending/i.test(String(status || ''));
}

function drawSectionTitle(doc, title, x, y, width) {
  doc.fillColor(COLOR.blue).rect(x, y, 4, 18).fill();
  doc.fillColor(COLOR.ink).font('Helvetica-Bold').fontSize(10)
    .text(title.toUpperCase(), x + 12, y + 4, { width: width - 12 });
  doc.fillColor(COLOR.line).rect(x, y + 22, width, 1).fill();
}

function drawField(doc, label, value, x, y, width, valueSize = 10) {
  doc.fillColor(COLOR.muted).font('Helvetica-Bold').fontSize(7)
    .text(label.toUpperCase(), x, y, { width });
  doc.fillColor(COLOR.ink).font('Helvetica-Bold').fontSize(valueSize)
    .text(String(value || 'Not specified'), x, y + 11, { width, lineBreak: false, ellipsis: true });
}

function drawPhoto(doc, dataUrl, x, y, width, height) {
  doc.roundedRect(x, y, width, height, 6).fillAndStroke(COLOR.wash, COLOR.line);
  doc.fillColor(COLOR.muted).font('Helvetica-Bold').fontSize(7)
    .text('STUDENT PHOTO', x, y + 10, { width, align: 'center' });

  const match = String(dataUrl || '').match(/^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/i);
  if (match) {
    try {
      doc.image(Buffer.from(match[2], 'base64'), x + 8, y + 25, {
        fit: [width - 16, height - 39], align: 'center', valign: 'center'
      });
      return;
    } catch (_) { /* fall through to a clear placeholder */ }
  }
  doc.fillColor(COLOR.muted).font('Helvetica').fontSize(8)
    .text('Photo unavailable', x, y + height / 2, { width, align: 'center' });
}

function drawDigitalSignatureMark(doc, x, y, verified) {
  const color = verified ? COLOR.green : COLOR.red;
  const wash = verified ? COLOR.greenWash : COLOR.redWash;
  doc.save();
  doc.circle(x, y, 11).fillAndStroke(wash, color);
  doc.strokeColor(color).lineWidth(2.2).lineCap('round').lineJoin('round');
  if (verified) {
    doc.moveTo(x - 5, y).lineTo(x - 1, y + 4).lineTo(x + 6, y - 5).stroke();
  } else {
    doc.moveTo(x - 4, y - 4).lineTo(x + 4, y + 4).stroke();
    doc.moveTo(x + 4, y - 4).lineTo(x - 4, y + 4).stroke();
  }
  doc.restore();
}

function createLeaveAuthorizationCertificate(gatePass) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const buffers = [];
    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const W = doc.page.width;
    const H = doc.page.height;
    const x = 42;
    const contentW = W - x * 2;
    const approved = isAuthorised(gatePass.status);
    const statusText = approved ? 'AUTHORISED' : String(gatePass.status || 'PENDING').toUpperCase();
    const statusColor = approved ? COLOR.green : COLOR.red;
    const statusWash = approved ? COLOR.greenWash : COLOR.redWash;

    // Brand header - clean and intentionally free of decorative seals.
    doc.rect(0, 0, W, 112).fill(COLOR.navy);
    doc.rect(0, 108, W, 4).fill(COLOR.blue);
    doc.fillColor(COLOR.white).font('Helvetica-Bold').fontSize(21).text('HF', x, 30);
    doc.fillColor('#B9C9DC').font('Helvetica').fontSize(7).text('HOSTEL SYSTEM', x, 55);
    doc.fillColor('#59728F').rect(x + 82, 28, 1, 38).fill();
    doc.fillColor(COLOR.white).font('Helvetica-Bold').fontSize(16)
      .text(INSTITUTION_NAME, x + 100, 32);
    doc.fillColor('#B9C9DC').font('Helvetica').fontSize(8.5)
      .text('Student Affairs and Hostel Administration', x + 100, 55);
    doc.fillColor(COLOR.white).font('Helvetica-Bold').fontSize(14)
      .text(DOCUMENT_TITLE.toUpperCase(), x, 80);
    doc.fillColor('#B9C9DC').font('Helvetica').fontSize(8)
      .text('Official student movement document', x + 190, 83);

    // Reference strip.
    let y = 136;
    doc.roundedRect(x, y, contentW, 56, 7).fillAndStroke(COLOR.wash, COLOR.line);
    drawField(doc, 'Reference no.', gatePass.id || 'N/A', x + 16, y + 12, 155, 9);
    drawField(doc, 'Certificate no.', gatePass.certificateId || 'Not issued', x + 185, y + 12, 165, 8.5);
    drawField(doc, 'Issued', new Date(gatePass.approvedAt || gatePass.createdAt || Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), x + 355, y + 12, 78, 7.5);
    doc.roundedRect(x + contentW - 108, y + 15, 92, 26, 13).fill(statusWash);
    doc.fillColor(statusColor).font('Helvetica-Bold').fontSize(8.5)
      .text(statusText, x + contentW - 108, y + 24, { width: 92, align: 'center' });

    y = 216;
    doc.fillColor(COLOR.ink).font('Helvetica').fontSize(10).text(
      'This certifies that the student named below is authorised to be away from the residence during the approved leave period. Present this document with a valid institutional ID when requested.',
      x, y, { width: contentW, lineGap: 3 }
    );

    // Identity section.
    y = 260;
    drawSectionTitle(doc, 'Student identity', x, y, contentW);
    y += 36;
    const photoW = 108;
    const detailsW = contentW - photoW - 24;
    doc.roundedRect(x, y, detailsW, 108, 7).fillAndStroke(COLOR.white, COLOR.line);
    drawField(doc, 'Student name', gatePass.student || 'N/A', x + 16, y + 18, 205, 12);
    drawField(doc, 'Registration number', gatePass.registrationNumber || 'N/A', x + 16, y + 70, 205, 11);
    drawField(doc, 'Hostel block', gatePass.hostelBlock || 'N/A', x + 240, y + 18, 120, 11);
    drawField(doc, 'Room number', gatePass.roomNumber || 'N/A', x + 240, y + 70, 120, 11);
    drawPhoto(doc, gatePass.studentPhoto, x + detailsW + 24, y, photoW, 108);

    // Leave period uses a visual journey instead of a dense form table.
    y += 130;
    drawSectionTitle(doc, 'Approved leave period', x, y, contentW);
    y += 36;
    doc.roundedRect(x, y, contentW, 96, 7).fillAndStroke(COLOR.sky, '#CFE0FF');
    drawField(doc, 'Leave begins', formatDate(gatePass.gateDate), x + 18, y + 18, 165, 11);
    drawField(doc, 'Session / time', gatePass.session || 'General', x + 18, y + 60, 165, 10);
    // Clean directional arrow from Leave Date to Return Date
    const arrowY = y + 45;
    doc.save();
    doc.strokeColor(COLOR.blue).fillColor(COLOR.blue).lineWidth(2);
    doc.moveTo(x + 215, arrowY).lineTo(x + 290, arrowY).stroke();
    doc.moveTo(x + 290, arrowY - 4).lineTo(x + 298, arrowY).lineTo(x + 290, arrowY + 4).closePath().fill();
    doc.restore();
    drawField(doc, 'Return by', formatDate(gatePass.returnDate), x + 332, y + 18, 155, 11);
    drawField(doc, 'Authorised by', gatePass.approvedBy || 'Pending approval', x + 332, y + 60, 155, 10);

    // Reason remains readable even for a longer explanation.
    y += 110;
    drawSectionTitle(doc, 'Purpose of leave', x, y, contentW);
    y += 36;
    doc.roundedRect(x, y, contentW, 62, 7).fillAndStroke(COLOR.wash, COLOR.line);
    doc.fillColor(COLOR.ink).font('Helvetica').fontSize(10)
      .text(String(gatePass.reason || 'Not specified'), x + 16, y + 16, { width: contentW - 32, height: 34, ellipsis: true, lineGap: 2 });

    // Verification block.
    y += 84;
    drawSectionTitle(doc, 'Digital verification', x, y, contentW);
    y += 36;
    const verifyH = 72;
    doc.roundedRect(x, y, contentW, verifyH, 7).fillAndStroke(COLOR.white, COLOR.line);
    const signatureVerified = Boolean(approved && gatePass.digitalSignature && gatePass.signatureFingerprint);
    const signatureColor = signatureVerified ? COLOR.green : COLOR.red;
    doc.roundedRect(x + 16, y + 12, 214, 48, 5).fill(signatureVerified ? COLOR.greenWash : COLOR.redWash);
    drawDigitalSignatureMark(doc, x + 34, y + 36, signatureVerified);
    doc.fillColor(signatureColor).font('Helvetica-Bold').fontSize(9)
      .text(signatureVerified ? 'Digitally signed and verified' : 'Digital signature pending', x + 52, y + 22, { width: 165 });
    doc.fillColor(COLOR.muted).font('Helvetica').fontSize(7)
      .text(signatureVerified
        ? `Signed by ${gatePass.approvedBy || 'Authorised officer'} on ${formatDateTime(gatePass.signedAt)}`
        : 'This pass is not valid until it has been digitally signed by an authorised officer.',
        x + 52, y + 39, { width: 165, height: 16, ellipsis: true });
    doc.fillColor(COLOR.muted).font('Helvetica-Bold').fontSize(7)
      .text('SIGNATURE FINGERPRINT • ECDSA P-256', x + 250, y + 14);
    doc.fillColor(COLOR.ink).font('Helvetica-Bold').fontSize(8)
      .text(gatePass.signatureFingerprint || 'Not available', x + 250, y + 26, { width: 230, ellipsis: true });
    doc.fillColor(COLOR.muted).font('Helvetica-Bold').fontSize(7)
      .text('SCAN TO VERIFY', x + 250, y + 45);
    doc.fillColor(COLOR.blue).font('Helvetica-Bold').fontSize(8)
      .text(gatePass.certificateId || gatePass.id || 'Not available', x + 250, y + 56, { width: 230 });

    // Draw the top information layer last so it stays crisp above embedded student photographs.
    doc.fillColor(COLOR.white).font('Helvetica-Bold').fontSize(21).text('HF', x, 30);
    doc.fillColor('#B9C9DC').font('Helvetica').fontSize(7).text('HOSTEL SYSTEM', x, 55);
    doc.fillColor('#59728F').rect(x + 82, 28, 1, 38).fill();
    doc.fillColor(COLOR.white).font('Helvetica-Bold').fontSize(16).text(INSTITUTION_NAME, x + 100, 32);
    doc.fillColor('#B9C9DC').font('Helvetica').fontSize(8.5).text('Student Affairs and Hostel Administration', x + 100, 55);
    doc.fillColor(COLOR.white).font('Helvetica-Bold').fontSize(14).text(DOCUMENT_TITLE.toUpperCase(), x, 80);
    doc.fillColor('#B9C9DC').font('Helvetica').fontSize(8).text('Official student movement document', x + 190, 83);
    doc.roundedRect(x, 136, contentW, 56, 7).fillAndStroke(COLOR.wash, COLOR.line);
    drawField(doc, 'Reference no.', gatePass.id || 'N/A', x + 16, 148, 155, 9);
    drawField(doc, 'Certificate no.', gatePass.certificateId || 'Not issued', x + 185, 148, 165, 8.5);
    drawField(doc, 'Issued', new Date(gatePass.approvedAt || gatePass.createdAt || Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), x + 355, 148, 78, 7.5);
    doc.roundedRect(x + contentW - 108, 151, 92, 26, 13).fill(statusWash);
    doc.fillColor(statusColor).font('Helvetica-Bold').fontSize(8.5).text(statusText, x + contentW - 108, 160, { width: 92, align: 'center' });
    doc.fillColor(COLOR.ink).font('Helvetica').fontSize(10).text(
      'This certifies that the student named below is authorised to be away from the residence during the approved leave period. Present this document with a valid institutional ID when requested.',
      x, 216, { width: contentW, lineGap: 3 }
    );

    // Footer.
    const footerY = H - 30;
    doc.fillColor(COLOR.line).rect(x, footerY, contentW, 1).fill();
    doc.fillColor(COLOR.muted).font('Helvetica').fontSize(7)
      .text('Computer-generated document - no physical signature or stamp is required.', x, footerY + 12);
    doc.text(`Generated ${formatDateTime(new Date())}`, x, footerY + 12, { width: contentW, align: 'right' });

    doc.end();
  });
}

module.exports = { createLeaveAuthorizationCertificate };

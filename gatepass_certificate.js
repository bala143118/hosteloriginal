const PDFDocument = require('pdfkit');
const crypto = require('crypto');

const INSTITUTION_NAME = 'HOSTELFIX STUDENT RESIDENCE';
const INSTITUTION_SUBTITLE = 'Department of Student Affairs & Hostel Administration';
const DOCUMENT_TITLE = 'LEAVE AUTHORIZATION CERTIFICATE';
const DOCUMENT_SUBTITLE = 'Digitally Signed Student Movement Pass';

// Colors — official government document palette
const COLOR = {
  navyHeader:   '#0B2447',
  accentGold:   '#C9A84C',
  accentBlue:   '#19376D',
  bodyText:     '#1a1a2e',
  labelText:    '#4a4a6a',
  borderLine:   '#c8cfe0',
  lightBg:      '#f4f6fb',
  white:        '#ffffff',
  stampGreen:   '#15803d',
  stampBg:      '#f0fdf4',
  stampBorder:  '#86efac',
  invalidRed:   '#dc2626',
  sigBlock:     '#f8f9ff',
  sigBorder:    '#a5b4fc',
};

function formatDate(value, opts = {}) {
  if (!value) return 'N/A';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric', ...opts
  });
}

function formatDateTime(value) {
  if (!value) return 'N/A';
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  });
}

/**
 * Draw a dashed rectangle border (like official document border)
 */
function dashedBorder(doc, x, y, w, h, color, dashLen = 4, gapLen = 4) {
  doc.save();
  doc.strokeColor(color).lineWidth(1);
  const drawDashedLine = (x1, y1, x2, y2) => {
    const len = Math.sqrt((x2-x1)**2 + (y2-y1)**2);
    const dx = (x2-x1)/len; const dy = (y2-y1)/len;
    let pos = 0; let drawing = true;
    while (pos < len) {
      const segLen = Math.min(drawing ? dashLen : gapLen, len - pos);
      if (drawing) doc.moveTo(x1+dx*pos, y1+dy*pos).lineTo(x1+dx*(pos+segLen), y1+dy*(pos+segLen)).stroke();
      pos += segLen; drawing = !drawing;
    }
  };
  drawDashedLine(x, y, x+w, y);
  drawDashedLine(x+w, y, x+w, y+h);
  drawDashedLine(x+w, y+h, x, y+h);
  drawDashedLine(x, y+h, x, y);
  doc.restore();
}

/**
 * Draw the official emblem / seal placeholder (circular crest)
 */
function drawSeal(doc, cx, cy, r, label) {
  // Outer ring
  doc.circle(cx, cy, r).lineWidth(2).strokeColor(COLOR.accentGold).stroke();
  doc.circle(cx, cy, r-4).lineWidth(0.5).strokeColor(COLOR.accentGold).stroke();
  // Inner fill
  doc.circle(cx, cy, r-6).fillColor('#fff8e1').fill();
  // Monogram
  doc.fillColor(COLOR.navyHeader).font('Helvetica-Bold').fontSize(14).text('HF', cx-12, cy-10);
  doc.fillColor(COLOR.accentGold).font('Helvetica').fontSize(5).text(label, cx - r + 6, cy + r - 12, { width: (r-3)*2, align: 'center' });
}

/**
 * Main certificate generation function.
 * @param {object} gatePass - Gate pass object from db.json
 * @returns {Promise<Buffer>} PDF buffer
 */
function createLeaveAuthorizationCertificate(gatePass) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const buffers = [];
    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const W = doc.page.width;   // 595
    const H = doc.page.height;  // 842
    const PAD = 36;             // page padding
    const CW = W - PAD * 2;     // content width = 523

    const isSigned = !!gatePass.digitalSignature;
    const status = String(gatePass.status || '').toUpperCase();
    const isApproved = /approved|security_pending|outside|completed|warden_pending/i.test(status);

    // ─────────────────────────────────────────────────────────
    // 1. PAGE BORDER — outer decorative double border
    // ─────────────────────────────────────────────────────────
    doc.rect(8, 8, W-16, H-16).lineWidth(3).strokeColor(COLOR.navyHeader).stroke();
    doc.rect(12, 12, W-24, H-24).lineWidth(1).strokeColor(COLOR.accentGold).stroke();

    // ─────────────────────────────────────────────────────────
    // 2. HEADER BAND
    // ─────────────────────────────────────────────────────────
    doc.rect(0, 0, W, 110).fill(COLOR.navyHeader);
    // Gold accent strip
    doc.rect(0, 108, W, 3).fill(COLOR.accentGold);

    // Seal left
    drawSeal(doc, PAD + 32, 55, 32, 'OFFICIAL SEAL');

    // Institution name + title (centred)
    doc.fillColor(COLOR.accentGold).font('Helvetica-Bold').fontSize(9)
       .text('GOVERNMENT OF INDIA RECOGNISED', 0, 18, { width: W, align: 'center' });
    doc.fillColor(COLOR.white).font('Helvetica-Bold').fontSize(16)
       .text(INSTITUTION_NAME, 0, 32, { width: W, align: 'center' });
    doc.fillColor('#b0bec5').font('Helvetica').fontSize(8)
       .text(INSTITUTION_SUBTITLE, 0, 52, { width: W, align: 'center' });
    doc.rect(W/2 - 80, 63, 160, 1).fill(COLOR.accentGold);
    doc.fillColor(COLOR.white).font('Helvetica-Bold').fontSize(13)
       .text(DOCUMENT_TITLE, 0, 68, { width: W, align: 'center' });
    doc.fillColor('#90caf9').font('Helvetica').fontSize(8)
       .text(DOCUMENT_SUBTITLE, 0, 85, { width: W, align: 'center' });

    // Seal right
    drawSeal(doc, W - PAD - 32, 55, 32, 'OFFICIAL SEAL');

    // ─────────────────────────────────────────────────────────
    // 3. REFERENCE / STATUS ROW
    // ─────────────────────────────────────────────────────────
    let y = 122;
    doc.rect(PAD, y, CW, 28).fillAndStroke(COLOR.lightBg, COLOR.borderLine);
    doc.fillColor(COLOR.labelText).font('Helvetica').fontSize(7.5)
       .text('REF NO:', PAD+10, y+6);
    doc.fillColor(COLOR.bodyText).font('Helvetica-Bold').fontSize(9)
       .text(gatePass.id || 'N/A', PAD+48, y+5);

    doc.fillColor(COLOR.labelText).font('Helvetica').fontSize(7.5)
       .text('CERT ID:', PAD+160, y+6);
    doc.fillColor(COLOR.accentBlue).font('Helvetica-Bold').fontSize(9)
       .text(gatePass.certificateId || '—', PAD+197, y+5);

    doc.fillColor(COLOR.labelText).font('Helvetica').fontSize(7.5)
       .text('ISSUED:', PAD+330, y+6);
    doc.fillColor(COLOR.bodyText).font('Helvetica').fontSize(8)
       .text(formatDateTime(gatePass.approvedAt || gatePass.createdAt), PAD+364, y+6);

    // Status badge
    const badgeColor = isApproved ? COLOR.stampGreen : COLOR.invalidRed;
    doc.roundedRect(PAD + CW - 90, y+4, 84, 20, 4).fill(badgeColor);
    doc.fillColor(COLOR.white).font('Helvetica-Bold').fontSize(8)
       .text(isApproved ? '✓ AUTHORISED' : '✗ ' + status, PAD + CW - 88, y+8, { width: 80, align: 'center' });

    // ─────────────────────────────────────────────────────────
    // 4. AUTHORIZATION BODY TEXT
    // ─────────────────────────────────────────────────────────
    y = 162;
    doc.fillColor(COLOR.labelText).font('Helvetica').fontSize(8.5).text(
      'This is to certify that the following student of this institution has been granted authorized leave from the hostel premises ' +
      'as per the details mentioned below. This document serves as an official leave authorization and the student is permitted to be ' +
      'away from the hostel during the specified period.',
      PAD, y, { width: CW, lineGap: 2, align: 'justify' }
    );

    // ─────────────────────────────────────────────────────────
    // 5. STUDENT DETAILS SECTION
    // ─────────────────────────────────────────────────────────
    y = 202;
    doc.rect(PAD, y, CW, 14).fill(COLOR.accentBlue);
    doc.fillColor(COLOR.white).font('Helvetica-Bold').fontSize(8)
       .text('STUDENT PARTICULARS', PAD+10, y+3);

    y += 16;

    // Photo box
    const photoX = PAD + CW - 112;
    const photoY = y;
    const photoW = 108; const photoH = 130;
    doc.rect(photoX, photoY, photoW, photoH).fillAndStroke(COLOR.lightBg, COLOR.borderLine);
    doc.fillColor(COLOR.labelText).font('Helvetica-Bold').fontSize(7)
       .text('STUDENT PHOTOGRAPH', photoX+4, photoY+6, { width: photoW-8, align: 'center' });

    const imageMatch = String(gatePass.studentPhoto || '').match(/^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/i);
    if (imageMatch) {
      try {
        const imgBuf = Buffer.from(imageMatch[2], 'base64');
        doc.image(imgBuf, photoX+8, photoY+20, { fit: [photoW-16, photoH-32], align: 'center', valign: 'center' });
      } catch (_) {
        doc.fillColor(COLOR.labelText).font('Helvetica').fontSize(7).text('Photo on file', photoX, photoY+70, { width: photoW, align: 'center' });
      }
    } else {
      doc.fillColor(COLOR.borderLine).font('Helvetica').fontSize(7).text('No Photo', photoX, photoY+70, { width: photoW, align: 'center' });
    }

    // Affixed stamp text below photo
    doc.fillColor(COLOR.labelText).font('Helvetica').fontSize(6)
       .text('Affixed & Verified', photoX, photoY + photoH - 14, { width: photoW, align: 'center' });

    // Field rows (left of photo)
    const fieldW = CW - photoW - 16;
    const fields = [
      ['Student Name',        gatePass.student || 'N/A'],
      ['Registration No.',    gatePass.registrationNumber || 'N/A'],
      ['Hostel Block',        gatePass.hostelBlock || 'N/A'],
      ['Room Number',         gatePass.roomNumber || 'N/A'],
    ];
    let fy = y;
    fields.forEach(([label, value]) => {
      doc.rect(PAD, fy, fieldW, 28).fillAndStroke(COLOR.white, COLOR.borderLine);
      doc.fillColor(COLOR.labelText).font('Helvetica').fontSize(7).text(label.toUpperCase(), PAD+8, fy+5);
      doc.fillColor(COLOR.bodyText).font('Helvetica-Bold').fontSize(10).text(String(value), PAD+8, fy+14, { width: fieldW-16 });
      fy += 30;
    });
    y = fy;

    // ─────────────────────────────────────────────────────────
    // 6. LEAVE DETAILS SECTION
    // ─────────────────────────────────────────────────────────
    y = Math.max(y, photoY + photoH + 6);
    doc.rect(PAD, y, CW, 14).fill(COLOR.accentBlue);
    doc.fillColor(COLOR.white).font('Helvetica-Bold').fontSize(8)
       .text('LEAVE PERIOD & AUTHORIZATION DETAILS', PAD+10, y+3);
    y += 16;

    const leaveFields = [
      ['Leave From (Gate Pass Date)',  formatDate(gatePass.gateDate)],
      ['Return By (Date)',             formatDate(gatePass.returnDate)],
      ['Session / Timing',            gatePass.session || 'General'],
      ['Authorized By',               gatePass.approvedBy || 'N/A'],
    ];
    const halfW = (CW - 4) / 2;
    leaveFields.forEach(([label, value], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const lx = PAD + col * (halfW + 4);
      const ly = y + row * 32;
      doc.rect(lx, ly, halfW, 28).fillAndStroke(COLOR.lightBg, COLOR.borderLine);
      doc.fillColor(COLOR.labelText).font('Helvetica').fontSize(7).text(label.toUpperCase(), lx+8, ly+5);
      doc.fillColor(COLOR.bodyText).font('Helvetica-Bold').fontSize(10).text(String(value), lx+8, ly+14, { width: halfW-16 });
    });
    y += Math.ceil(leaveFields.length / 2) * 32 + 4;

    // Purpose / Reason
    doc.rect(PAD, y, CW, 44).fillAndStroke(COLOR.white, COLOR.borderLine);
    doc.fillColor(COLOR.labelText).font('Helvetica').fontSize(7).text('PURPOSE OF LEAVE / REASON', PAD+8, y+6);
    doc.fillColor(COLOR.bodyText).font('Helvetica').fontSize(9)
       .text(String(gatePass.reason || 'Not specified'), PAD+8, y+16, { width: CW-16, lineGap: 2 });
    y += 48;

    // ─────────────────────────────────────────────────────────
    // 7. DIGITAL SIGNATURE BLOCK (the key new section)
    // ─────────────────────────────────────────────────────────
    y += 4;
    // Outer box
    doc.roundedRect(PAD, y, CW, 100, 6).fillAndStroke(COLOR.sigBlock, COLOR.sigBorder);

    // Header strip inside sig block
    doc.roundedRect(PAD, y, CW, 18, 6).fill(COLOR.accentBlue);
    doc.rect(PAD, y+12, CW, 6).fill(COLOR.accentBlue); // square bottom corners
    doc.fillColor(COLOR.white).font('Helvetica-Bold').fontSize(8)
       .text('🔐  DIGITAL SIGNATURE CERTIFICATE  — ECDSA P-256', PAD+10, y+5);

    if (isSigned) {
      // Signature present
      doc.roundedRect(PAD+8, y+24, 20, 20, 3).fill(COLOR.stampGreen);
      doc.fillColor(COLOR.white).font('Helvetica-Bold').fontSize(12).text('✓', PAD+12, y+27);

      doc.fillColor(COLOR.stampGreen).font('Helvetica-Bold').fontSize(9)
         .text('Digitally Signed by Authorised Officer', PAD+34, y+25);
      doc.fillColor(COLOR.bodyText).font('Helvetica').fontSize(7.5)
         .text(`Signed on: ${formatDateTime(gatePass.signedAt)}`, PAD+34, y+36);
      doc.fillColor(COLOR.labelText).font('Helvetica').fontSize(7)
         .text(`Algorithm: ${gatePass.signatureAlgorithm || 'ECDSA-P256-SHA256'}`, PAD+34, y+46);

      // Fingerprint display
      doc.rect(PAD+8, y+58, CW-16, 18).fill('#e0e7ff');
      doc.fillColor(COLOR.labelText).font('Helvetica').fontSize(7).text('SIGNATURE FINGERPRINT', PAD+14, y+61);
      doc.fillColor(COLOR.accentBlue).font('Helvetica-Bold').fontSize(8)
         .text(gatePass.signatureFingerprint || '—', PAD+116, y+60);

      // Authorised stamp
      doc.save();
      doc.rotate(-18, { origin: [PAD + CW - 70, y + 60] });
      doc.roundedRect(PAD + CW - 105, y + 48, 92, 36, 4)
         .lineWidth(2).strokeColor(COLOR.stampGreen).stroke();
      doc.fillColor(COLOR.stampGreen).font('Helvetica-Bold').fontSize(7.5)
         .text('DIGITALLY', PAD + CW - 101, y + 54, { width: 84, align: 'center' });
      doc.fillColor(COLOR.stampGreen).font('Helvetica-Bold').fontSize(9)
         .text('AUTHORISED', PAD + CW - 101, y + 63, { width: 84, align: 'center' });
      doc.fillColor(COLOR.stampGreen).font('Helvetica').fontSize(6.5)
         .text(String(gatePass.approvedBy || 'Warden').toUpperCase(), PAD + CW - 101, y + 74, { width: 84, align: 'center' });
      doc.restore();

      doc.fillColor(COLOR.labelText).font('Helvetica').fontSize(6.5)
         .text(
           'This certificate bears the cryptographic digital signature of the authorizing officer. The signature can be independently ' +
           'verified at /api/gatepass/verify/' + (gatePass.id || '') + ' using the institution public key.',
           PAD+8, y+80, { width: CW-100, lineGap: 1.5 }
         );
    } else {
      // Not signed (pending/rejected)
      doc.fillColor(COLOR.invalidRed).font('Helvetica-Bold').fontSize(10)
         .text('⚠  NO DIGITAL SIGNATURE — DOCUMENT NOT AUTHORISED', PAD+10, y+30, { width: CW-20 });
      doc.fillColor(COLOR.labelText).font('Helvetica').fontSize(8)
         .text('This gate pass has not been approved. Digital signature is applied automatically when the warden approves the request.', PAD+10, y+50, { width: CW-20, lineGap: 2 });
    }

    y += 106;

    // ─────────────────────────────────────────────────────────
    // 8. QR CODE + VERIFICATION ROW
    // ─────────────────────────────────────────────────────────
    y += 4;
    const qrMatch = String(gatePass.qrImage || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/i);
    const qrBuf = qrMatch ? Buffer.from(qrMatch[1], 'base64') : null;

    doc.roundedRect(PAD, y, CW, 80, 6).fillAndStroke(COLOR.white, COLOR.borderLine);

    if (qrBuf) {
      try {
        doc.image(qrBuf, PAD+8, y+8, { fit: [64, 64] });
      } catch (_) {}
    } else {
      doc.roundedRect(PAD+8, y+8, 64, 64, 4).fillAndStroke(COLOR.lightBg, COLOR.borderLine);
      doc.fillColor(COLOR.borderLine).font('Helvetica').fontSize(6).text('QR', PAD+32, y+36);
    }

    doc.fillColor(COLOR.accentBlue).font('Helvetica-Bold').fontSize(9)
       .text('SCAN TO VERIFY AUTHENTICITY', PAD+84, y+10);
    doc.fillColor(COLOR.labelText).font('Helvetica').fontSize(7.5)
       .text(
         'Security officers must scan this QR code at the gate. The QR code links to a live verification endpoint that confirms ' +
         'this document is genuine and digitally signed by an authorised officer.',
         PAD+84, y+22, { width: CW-96, lineGap: 2 }
       );
    doc.fillColor(COLOR.labelText).font('Helvetica').fontSize(7).text('Verification endpoint:', PAD+84, y+52);
    doc.fillColor(COLOR.accentBlue).font('Helvetica-Bold').fontSize(7)
       .text(`/api/gatepass/verify/${gatePass.id || ''}`, PAD+163, y+52);
    doc.fillColor(COLOR.labelText).font('Helvetica').fontSize(7).text(`Certificate ID: ${gatePass.certificateId || 'N/A'}`, PAD+84, y+62);

    y += 84;

    // ─────────────────────────────────────────────────────────
    // 9. AUTHORISATION FOOTER — signature lines
    // ─────────────────────────────────────────────────────────
    y += 6;
    const sigLineY = y + 20;
    const cols3 = CW / 3;

    // Three signature columns
    [
      ['Student Signature', gatePass.student || 'Student'],
      ['Hostel Warden', gatePass.approvedBy || 'Warden Officer'],
      ['Principal / Director', 'Institution Head']
    ].forEach(([role, name], i) => {
      const sx = PAD + i * cols3;
      doc.rect(sx + 10, sigLineY, cols3 - 20, 0.5).fill(COLOR.bodyText);
      doc.fillColor(COLOR.bodyText).font('Helvetica-Bold').fontSize(7.5)
         .text(role, sx, sigLineY + 4, { width: cols3, align: 'center' });
      doc.fillColor(COLOR.labelText).font('Helvetica').fontSize(7)
         .text(name, sx, sigLineY + 14, { width: cols3, align: 'center' });
      if (i > 0 && isSigned) {
        doc.fillColor(COLOR.stampGreen).font('Helvetica').fontSize(6)
           .text('(Digitally Signed)', sx, sigLineY + 23, { width: cols3, align: 'center' });
      }
    });

    y = sigLineY + 34;

    // ─────────────────────────────────────────────────────────
    // 10. FOOTER
    // ─────────────────────────────────────────────────────────
    doc.rect(PAD, y, CW, 0.5).fill(COLOR.accentGold);
    y += 4;
    doc.fillColor(COLOR.labelText).font('Helvetica').fontSize(6.5)
       .text(
         `This is a computer-generated digitally signed document. It does not require a physical stamp or wet signature. ` +
         `Generated: ${new Date().toLocaleString('en-IN')} • HostelFix v2 Digital Authorization System`,
         PAD, y, { width: CW, align: 'center', lineGap: 1 }
       );

    // Dashed inner border
    dashedBorder(doc, 20, 20, W-40, H-40, COLOR.accentGold, 3, 5);

    doc.end();
  });
}

module.exports = { createLeaveAuthorizationCertificate };

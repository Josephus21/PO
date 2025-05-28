const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const emailjs = require('@emailjs/nodejs');
const path = require('path');
const cron = require('node-cron');

const app = express();
const PORT = 3000;
const poFile = './poData.json'; // <-- updated filename

// Middleware
app.use(bodyParser.json());
app.use(express.static('public')); // for your HTML/CSS/JS

// Load POs
function loadPOs() {
  if (!fs.existsSync(poFile)) return [];
  const data = fs.readFileSync(poFile, 'utf8');
  return JSON.parse(data);
}

// Save POs
function savePOs(pos) {
  fs.writeFileSync(poFile, JSON.stringify(pos, null, 2));
}

// GET /api/pos
app.get('/api/pos', (req, res) => {
  res.json(loadPOs());
});

// POST /api/pos
app.post('/api/pos', (req, res) => {
  const pos = loadPOs();
  pos.push(req.body);
  savePOs(pos);
  res.status(200).send('PO saved successfully.');
});

// Function to check pending POs and send emails
function checkPendingPOsAndSendEmails() {
  const pos = loadPOs();

  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normalize time

  pos.forEach(po => {
    if (po.status === 'Pending' && po.plannedDate) {
      // Parse plannedDate safely
      const plannedDate = new Date(po.plannedDate);
      plannedDate.setHours(0, 0, 0, 0);

      console.log(`Checking PO#${po.po}: Planned Date = ${plannedDate.toISOString().slice(0,10)}, Today = ${today.toISOString().slice(0,10)}`);

      if (plannedDate < today) {
        if (po.email) {
          console.log(`Sending email to ${po.email} for overdue PO#${po.po}`);
          emailjs.send('service_ag09nqo', 'template_aj6qf3v', {
            to_name: po.name,
            to_email: po.email,
            po_number: po.po,
            planned_return_date: po.plannedDate,
          }, {
            publicKey: 'tSIk70XD7Rqfn0RIr'
          }).then(() => {
            console.log(`Reminder email sent to ${po.name} (${po.email})`);
          }).catch((err) => {
            console.error(`Failed to send email to ${po.email}:`, err);
          });
        } else {
          console.log(`PO#${po.po} has no email address.`);
        }
      } else {
        console.log(`PO#${po.po} is NOT overdue. No email sent.`);
      }
    } else {
      console.log(`PO#${po.po} is not Pending or has no plannedDate.`);
    }
  });
}



// Schedule: every day at 9 AM
cron.schedule('0 9 * * *', () => {
  console.log('Running daily PO check...');
  checkPendingPOsAndSendEmails();
});

// Optional: manual trigger for testing
app.get('/check-pending', (req, res) => {
  checkPendingPOsAndSendEmails();
  res.send('Pending PO check and email trigger completed.');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

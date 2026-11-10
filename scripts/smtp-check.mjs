// SMTP-Verbindung prüfen und eine Testmail an den festen Empfänger schicken.
// Docker:  sudo docker compose exec app node scripts/smtp-check.mjs
// systemd: node --env-file=/etc/hydrantenkarte.env scripts/smtp-check.mjs
// lokal:   npm run mail:test
import {createTransport, describeMailError, recipient} from '../server.mjs';

const env = process.env;
const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'].filter(k => !env[k]);
if (missing.length) {
  console.error('Fehlende Einstellungen:', missing.join(', '));
  process.exit(1);
}
const RECIPIENT = recipient(env);
if (!RECIPIENT) { console.error('Kein gültiger Empfänger: MAIL_TO oder MAIL_FROM prüfen'); process.exit(1); }
const port = env.SMTP_PORT || '587';
console.log(`Server:   ${env.SMTP_HOST}:${port} (${port === '465' ? 'TLS' : 'STARTTLS'})`);
console.log(`Benutzer: ${env.SMTP_USER}`);
console.log(`Absender: ${env.MAIL_FROM}`);
console.log(`Empfänger: ${RECIPIENT}${env.MAIL_TO ? '' : ' (aus MAIL_FROM, MAIL_TO nicht gesetzt)'}`);
console.log(`Passwort: ${env.SMTP_PASS.length} Zeichen${/^\s|\s$|^["']|["']$/.test(env.SMTP_PASS) ? ' – ACHTUNG: beginnt/endet mit Leerzeichen oder Anführungszeichen' : ''}`);

const transport = createTransport(env);
try {
  await transport.verify();
  console.log('✓ Verbindung und Anmeldung erfolgreich');
} catch (err) {
  console.error('✗ Verbindung/Anmeldung fehlgeschlagen:', describeMailError(err));
  if (['ETIMEDOUT', 'ECONNREFUSED', 'ESOCKET', 'ECONNECTION'].includes(err.code)) console.error('  → Server bzw. Port vom Server aus nicht erreichbar (Firewall, falscher Host/Port?)');
  if (err.code === 'EAUTH' || err.responseCode === 535) console.error('  → Benutzer oder Passwort falsch');
  process.exit(1);
}
try {
  const info = await transport.sendMail({from: env.MAIL_FROM, to: RECIPIENT, subject: 'Hydrantenkarte: Testmail', text: 'SMTP-Test erfolgreich.'});
  console.log('✓ Testmail angenommen:', info.response);
  if (info.rejected?.length) console.error('✗ Abgelehnt für:', info.rejected.join(', '));
  console.log('  Jetzt Posteingang und Spam-Ordner prüfen. Kommt stattdessen eine Rückläufer-Mail („Mail delivery failed“) ins Absender-Postfach, lehnt der Empfänger-Mailserver ab – dann SPF/DKIM/DMARC der Absender-Domain prüfen oder MAIL_TO auf ein anderes Postfach setzen.');
} catch (err) {
  console.error('✗ Versand fehlgeschlagen:', describeMailError(err));
  if (err.responseCode === 553 || err.responseCode === 550 || /sender|from/i.test(err.response || '')) console.error('  → MAIL_FROM wird vom Mailserver nicht akzeptiert; meist muss es dieselbe Adresse wie SMTP_USER sein');
  process.exit(1);
}

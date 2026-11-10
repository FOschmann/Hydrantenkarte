// Speicher für Hydranten-Notizen: eine JSON-Datei plus geheimer Schlüssel für die Freigabe-Links.
import {readFile, writeFile, rename, mkdir} from 'node:fs/promises';
import {randomBytes, randomUUID, createHmac, timingSafeEqual} from 'node:crypto';
import path from 'node:path';

const MAX_PENDING = 300;

export class NoteStore {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'notes.json');
    this.secretFile = path.join(dir, 'notes.secret');
    this.notes = null;
    this.secret = null;
    this.queue = Promise.resolve();
  }

  async load() {
    if (this.notes) return;
    await mkdir(this.dir, {recursive: true});
    try {
      this.notes = JSON.parse(await readFile(this.file, 'utf8')).notes || [];
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.notes = [];
    }
    try {
      this.secret = (await readFile(this.secretFile, 'utf8')).trim();
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    if (!this.secret || this.secret.length < 32) {
      this.secret = randomBytes(32).toString('hex');
      await writeFile(this.secretFile, this.secret, {mode: 0o600});
    }
  }

  // Schreibvorgänge nacheinander und atomar (erst Temp-Datei, dann umbenennen)
  save() {
    this.queue = this.queue.then(async () => {
      const tmp = this.file + '.tmp';
      await writeFile(tmp, JSON.stringify({notes: this.notes}, null, 1));
      await rename(tmp, this.file);
    });
    return this.queue;
  }

  sign(id) {
    return createHmac('sha256', this.secret).update(String(id)).digest('hex').slice(0, 40);
  }

  verify(id, sig) {
    const expected = Buffer.from(this.sign(id));
    const given = Buffer.from(String(sig || ''));
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  async add({hydrantId, lat, lng, text, email}) {
    await this.load();
    if (this.notes.filter(n => n.status === 'pending').length >= MAX_PENDING) throw Object.assign(new Error('Zu viele offene Notizen'), {code: 'FULL'});
    const note = {id: randomUUID(), hydrantId, lat, lng, text, email: email || '', status: 'pending', created: new Date().toISOString(), decided: null};
    this.notes.push(note);
    await this.save();
    return note;
  }

  async get(id) {
    await this.load();
    return this.notes.find(n => n.id === id) || null;
  }

  async remove(id) {
    await this.load();
    this.notes = this.notes.filter(n => n.id !== id);
    await this.save();
  }

  async setStatus(id, status) {
    await this.load();
    const note = this.notes.find(n => n.id === id);
    if (!note) return null;
    note.status = status;
    note.decided = new Date().toISOString();
    // Abgelehnte Notizen brauchen keine Kontaktdaten mehr
    if (status === 'rejected') note.email = '';
    await this.save();
    return note;
  }

  // Öffentliche Sicht: nur Hydrant, Text und Datum, nie die E-Mail-Adresse
  async published() {
    await this.load();
    return this.notes.filter(n => n.status === 'published')
      .map(n => ({id: n.id, hydrantId: n.hydrantId, text: n.text, date: n.decided || n.created}));
  }
}

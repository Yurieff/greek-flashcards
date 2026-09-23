// Parser for the grvocab CSV. Lenient where the real data needs it:
// a quote only opens a quoted field at the start of a field, and extra
// fields (an unquoted comma in the last column) are joined into etymology.
const COLUMNS = 7;

function splitRecords(text) {
  const records = [];
  let fields = [];
  let field = '';
  let inQuotes = false;
  let atFieldStart = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = false;
    } else if (c === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
    } else if (c === ',') {
      fields.push(field);
      field = '';
      atFieldStart = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      fields.push(field);
      records.push(fields);
      fields = [];
      field = '';
      atFieldStart = true;
    } else {
      field += c;
      atFieldStart = false;
    }
  }
  if (field !== '' || fields.length) {
    fields.push(field);
    records.push(fields);
  }
  return records.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

export function parseCsv(text) {
  const [, ...rows] = splitRecords(text.replace(/^\uFEFF/, ''));
  const words = [];
  const seen = new Set();
  let skipped = 0;
  for (const row of rows) {
    const fields = row.length > COLUMNS
      ? [...row.slice(0, COLUMNS - 1), row.slice(COLUMNS - 1).join(',')]
      : row;
    const [initial, basic, past, future, translation, additional, etymology] = fields.map((f) => f.trim());
    if (fields.length < COLUMNS || !basic || !translation || seen.has(basic)) {
      skipped++;
      continue;
    }
    seen.add(basic);
    words.push({ initial, basic, past, future, translation, additional, etymology, index: words.length });
  }
  return { words, skipped };
}

// Minimal valid, deterministic PDF for text-extraction acceptance tests.
export function pdfFixture(pages: string[]): Uint8Array {
  const enc = new TextEncoder(),
    font = 3 + pages.length * 2;
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  ];
  for (let i = 0; i < pages.length; i++) {
    const lines = pages[i]
      .split("\n")
      .map((line) => line.replace(/([\\()])/g, "\\$1"));
    const stream =
      "BT /F1 12 Tf 45 750 Td " +
      lines
        .map((line, n) => (n ? "0 -24 Td " : "") + `(${line}) Tj`)
        .join(" ") +
      " ET";
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${4 + i * 2} 0 R >>`,
      `<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(enc.encode(body).length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const at = enc.encode(body).length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((n) => {
    body += n.toString().padStart(10, "0") + " 00000 n \n";
  });
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`;
  return enc.encode(body);
}

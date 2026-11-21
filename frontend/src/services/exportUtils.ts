import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

export function exportToExcel(rows: Record<string, any>[], filename: string, sheetName = 'Relatorio') {
  if (!rows || rows.length === 0) {
    alert('Nenhum dado disponível para exportar.');
    return;
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export function exportToPDF(rows: Record<string, any>[], title: string, filename: string) {
  if (!rows || rows.length === 0) {
    alert('Nenhum dado disponível para exportar.');
    return;
  }
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(15);
  doc.setTextColor(29, 78, 216);
  doc.text('MERCHANDISING PRO', 14, 15);
  doc.setFontSize(11);
  doc.setTextColor(51, 65, 85);
  doc.text(title, 14, 22);
  doc.setFontSize(8);
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 27);

  const columns = Object.keys(rows[0]);
  const body = rows.map((row) => columns.map((c) => (row[c] === null || row[c] === undefined ? '-' : String(row[c]))));

  autoTable(doc, {
    startY: 32,
    head: [columns.map((c) => c.replace(/_/g, ' '))],
    body,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [29, 78, 216] },
  });

  doc.save(`${filename}.pdf`);
}

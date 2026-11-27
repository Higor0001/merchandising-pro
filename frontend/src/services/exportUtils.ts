import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

export function exportToExcel(rows: Record<string, any>[], filename: string, sheetName = 'Relatorio'): boolean {
  if (!rows || rows.length === 0) {
    return false;
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${filename}.xlsx`);
  return true;
}

export function exportToPDF(rows: Record<string, any>[], title: string, filename: string): boolean {
  if (!rows || rows.length === 0) {
    return false;
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
  return true;
}

function slugifyFilePart(str: string): string {
  return String(str || 'visita')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
}

async function fetchImageAsJpegDataUrl(url: string): Promise<{ dataUrl: string; aspect: number } | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    try {
      return await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const maxW = 720;
          const scale = img.width > maxW ? maxW / img.width : 1;
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          resolve({
            dataUrl: canvas.toDataURL('image/jpeg', 0.82),
            aspect: w / h,
          });
        };
        img.onerror = () => resolve(null);
        img.src = objUrl;
      });
    } finally {
      URL.revokeObjectURL(objUrl);
    }
  } catch {
    return null;
  }
}

export interface VisitReportPayload {
  visit: any;
  store?: any;
  promoter?: any;
  checklist?: any[];
  summary?: any;
}

/**
 * Gera e baixa o dossiê completo em PDF de uma visita (dados da loja, check-in/out, diagnóstico,
 * checklist, abastecimento, validades, preços, ocorrências e miniaturas das fotos Antes × Depois).
 */
export async function exportVisitHistoryPDF(report: VisitReportPayload): Promise<boolean> {
  const { visit, store, promoter, checklist = [], summary = {} } = report || {};
  if (!visit) return false;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  let y = 14;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageH - 14) {
      doc.addPage();
      y = 16;
    }
  };

  // Cabeçalho corporativo
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(margin, y, pageW - margin * 2, 24, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('MERCHANDISING PRO — Histórico de Visita', margin + 5, y + 9);
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `Visita #${visit.id}  •  ${store?.name || 'Loja'}  •  Status: ${visit.status || '-'}`,
    margin + 5,
    y + 15.5
  );
  doc.setFontSize(8);
  doc.setTextColor(203, 213, 225);
  doc.text(
    `Gerado em ${new Date().toLocaleString('pt-BR')}  •  Promotor: ${promoter?.name || visit.promoter_name || '-'}`,
    margin + 5,
    y + 21
  );
  y += 30;

  // 1. Dados da Visita e Loja
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('1. Identificação da Visita & Ponto de Venda', margin, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 2.2 },
    columnStyles: { 0: { fontStyle: 'bold', fillColor: [241, 245, 249], cellWidth: 42 } },
    body: [
      ['Loja / PDV', `${store?.name || '-'} (${store?.type || '-'})`],
      ['Endereço', `${store?.address || '-'}${store?.city ? ` — ${store.city}` : ''}`],
      ['Bandeira / Rota', `${store?.banner || store?.network || '-'} • Rota: ${store?.route_name || '-'}`],
      ['Promotor', promoter?.name || visit.promoter_name || '-'],
      ['Data Agendada', `${visit.scheduled_date || '-'} ${visit.scheduled_time || ''}`.trim()],
      ['Check-in / Check-out', `${visit.checkin_at || '-'}  →  ${visit.checkout_at || '-'} (${visit.duration_minutes || 0} min)`],
      ['Status da Visita', visit.status || '-'],
    ],
  });
  y = ((doc as any).lastAutoTable?.finalY || y + 35) + 7;

  // 2. Resumo Operacional
  ensureSpace(35);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('2. Resumo Operacional da Visita', margin, y);
  y += 3;

  const evs = summary.evidences || {};
  const totalPhotos =
    (evs.selfie_entrada?.length || 0) +
    (evs.initial?.length || 0) +
    (evs.complementary?.length || 0) +
    (evs.final?.length || 0);

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Indicador', 'Total', 'Indicador', 'Total']],
    body: [
      ['Itens Abastecidos', `${summary.replenished_items_count ?? (summary.replenishments?.length || 0)} (${summary.total_replenished_qty || 0} un)`, 'Validades Conferidas', String(summary.expiries_count ?? (summary.expiries?.length || 0))],
      ['Precificações', String(summary.price_checks_count ?? (summary.price_checks?.length || 0)), 'Exposições / Displays', String(summary.displays_count ?? (summary.displays?.length || 0))],
      ['Ocorrências / Rupturas', `${summary.occurrences_count ?? (summary.occurrences?.length || 0)} (${summary.ruptures_count || 0} rupturas)`, 'Checklist Concluído', `${summary.checklist_done || 0} / ${summary.checklist_total || checklist.length}`],
      ['Evidências Fotográficas', `${totalPhotos} foto(s) em HD`, 'Retirados (Vencidos)', `${summary.removed_products_qty || 0} un`],
    ],
    styles: { fontSize: 8.5, cellPadding: 2.2 },
    headStyles: { fillColor: [29, 78, 216] },
  });
  y = ((doc as any).lastAutoTable?.finalY || y + 30) + 7;

  // 3. Diagnóstico Inicial
  if (summary.diagnostic?.answers) {
    ensureSpace(35);
    const a = summary.diagnostic.answers;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('3. Diagnóstico Inicial do PDV', margin, y);
    y += 3;

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Critério', 'Avaliação', 'Observação / Detalhe']],
      body: [
        ['Exposição Geral', a.exposicao || '-', a.obs_exposicao || '-'],
        ['Organização da Gôndola', a.organizacao_gondola || '-', a.obs_gondola || '-'],
        ['Abastecimento', a.abastecimento || '-', a.obs_abastecimento || '-'],
        ['Rupturas Identificadas', a.tem_rupturas ? 'Sim' : 'Não', a.detalhes_rupturas || '-'],
        ['Produtos Vencidos', a.tem_vencidos ? 'Sim' : 'Não', a.detalhes_vencidos || '-'],
        ['Próximo do Vencimento', a.tem_proximo_vencimento ? 'Sim' : 'Não', a.detalhes_proximo_vencimento || '-'],
        ['Produtos sem Preço', a.tem_sem_preco ? 'Sim' : 'Não', a.detalhes_sem_preco || '-'],
        ['Divergência de Preço', a.tem_divergencia_preco ? 'Sim' : 'Não', a.detalhes_divergencia_preco || '-'],
        ['Concorrência no Espaço', a.tem_concorrencia_espaco ? 'Sim' : 'Não', a.detalhes_concorrencia || '-'],
      ],
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [30, 64, 175] },
    });
    y = ((doc as any).lastAutoTable?.finalY || y + 40) + 7;
  }

  // 4. Abastecimento
  const reps = summary.replenishments || [];
  if (reps.length > 0) {
    ensureSpace(30);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`Abastecimento Registrado (${reps.length})`, margin, y);
    y += 3;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Produto', 'Gramatura', 'Abast.', 'Gôndola', 'Retag.', 'Status']],
      body: reps.map((r: any) => [
        r.product_name || '-',
        r.product_weight || '-',
        String(r.quantity_replenished ?? 0),
        String(r.gondola_stock ?? 0),
        String(r.backroom_stock ?? 0),
        r.status || '-',
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [15, 118, 110] },
    });
    y = ((doc as any).lastAutoTable?.finalY || y + 25) + 7;
  }

  // 5. Validades
  const exps = summary.expiries || [];
  if (exps.length > 0) {
    ensureSpace(30);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`Controle de Validade & PVPS (${exps.length})`, margin, y);
    y += 3;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Produto', 'Lote', 'Validade', 'Qtd', 'Condição']],
      body: exps.map((e: any) => [
        e.product_name || '-',
        e.batch_code || '-',
        e.expiry_date || '-',
        String(e.quantity ?? 0),
        e.condition || '-',
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [190, 18, 60] },
    });
    y = ((doc as any).lastAutoTable?.finalY || y + 25) + 7;
  }

  // 6. Precificação
  const prices = summary.price_checks || [];
  if (prices.length > 0) {
    ensureSpace(30);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`Conferência de Preços (${prices.length})`, margin, y);
    y += 3;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Produto', 'Preço Gôndola', 'Promo', 'Etiqueta', 'Concorrente']],
      body: prices.map((p: any) => [
        p.product_name || '-',
        p.gondola_price != null ? `R$ ${Number(p.gondola_price).toFixed(2)}` : '-',
        p.promo_price != null ? `R$ ${Number(p.promo_price).toFixed(2)}` : '-',
        p.has_price_tag === 0 ? 'Sem etiqueta' : 'OK',
        p.competitor_name ? `${p.competitor_name}${p.competitor_price ? ` (R$ ${Number(p.competitor_price).toFixed(2)})` : ''}` : '-',
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [180, 83, 9] },
    });
    y = ((doc as any).lastAutoTable?.finalY || y + 25) + 7;
  }

  // 7. Ocorrências
  const occs = summary.occurrences || summary.unresolved_pendencies || [];
  if (occs.length > 0) {
    ensureSpace(30);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`Ocorrências & Pendências (${occs.length})`, margin, y);
    y += 3;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Tipo', 'Prioridade', 'Status', 'Descrição']],
      body: occs.map((o: any) => [o.type || '-', o.priority || '-', o.status || '-', o.description || '-']),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [185, 28, 28] },
    });
    y = ((doc as any).lastAutoTable?.finalY || y + 25) + 7;
  }

  // 8. Checklist
  if (checklist.length > 0) {
    ensureSpace(30);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`Checklist da Visita (${checklist.filter((c) => c.completed).length}/${checklist.length})`, margin, y);
    y += 3;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Status', 'Atividade']],
      body: checklist.map((c: any) => [c.completed ? 'Concluído' : 'Pendente', c.label || '-']),
      styles: { fontSize: 8, cellPadding: 1.8 },
      columnStyles: { 0: { cellWidth: 26, fontStyle: 'bold' } },
      headStyles: { fillColor: [51, 65, 85] },
    });
    y = ((doc as any).lastAutoTable?.finalY || y + 25) + 7;
  }

  // 9. Observações finais
  if (visit.notes || visit.problems_found || visit.opportunities_found) {
    ensureSpace(28);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Observações e Notas de Check-out', margin, y);
    y += 3;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      theme: 'grid',
      styles: { fontSize: 8.5, cellPadding: 2.2 },
      columnStyles: { 0: { fontStyle: 'bold', fillColor: [241, 245, 249], cellWidth: 42 } },
      body: [
        ['Problemas Encontrados', visit.problems_found || '-'],
        ['Oportunidades', visit.opportunities_found || '-'],
        ['Observações Gerais', visit.notes || '-'],
      ],
    });
    y = ((doc as any).lastAutoTable?.finalY || y + 25) + 7;
  }

  // 10. Evidências Fotográficas embutidas
  const allEvidences = [
    ...(evs.selfie_entrada || []).map((p: any) => ({ ...p, stageLabel: 'Selfie na Entrada' })),
    ...(evs.initial || []).map((p: any) => ({ ...p, stageLabel: 'Foto Inicial (Antes)' })),
    ...(evs.complementary || []).map((p: any) => ({ ...p, stageLabel: 'Foto Complementar' })),
    ...(evs.final || []).map((p: any) => ({ ...p, stageLabel: 'Foto Final (Depois)' })),
  ];

  if (allEvidences.length > 0) {
    ensureSpace(60);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`Evidências Fotográficas (${allEvidences.length})`, margin, y);
    y += 5;

    const colW = (pageW - margin * 2 - 6) / 2;
    const imgBoxH = 44;
    let colIdx = 0;

    for (const ev of allEvidences.slice(0, 16)) {
      if (colIdx === 0) ensureSpace(imgBoxH + 14);
      const x = margin + colIdx * (colW + 6);
      const loaded = await fetchImageAsJpegDataUrl(ev.photo_url);

      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(x, y, colW, imgBoxH + 10, 2, 2, 'S');

      if (loaded?.dataUrl) {
        const maxImgW = colW - 4;
        const maxImgH = imgBoxH - 2;
        let drawW = maxImgW;
        let drawH = drawW / loaded.aspect;
        if (drawH > maxImgH) {
          drawH = maxImgH;
          drawW = drawH * loaded.aspect;
        }
        const offsetX = x + 2 + (maxImgW - drawW) / 2;
        const offsetY = y + 2 + (maxImgH - drawH) / 2;
        doc.addImage(loaded.dataUrl, 'JPEG', offsetX, offsetY, drawW, drawH);
      } else {
        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139);
        doc.text('Imagem registrada no servidor', x + 4, y + 22);
      }

      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      const label = `${ev.stageLabel} • ${ev.area || 'PDV'}${ev.is_panoramic ? ' (Panorâmica)' : ''}`.slice(0, 52);
      doc.text(label, x + 2.5, y + imgBoxH + 4.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(String(ev.captured_at || ''), x + 2.5, y + imgBoxH + 8.5);

      colIdx++;
      if (colIdx === 2) {
        colIdx = 0;
        y += imgBoxH + 14;
      }
    }
    if (colIdx === 1) {
      y += imgBoxH + 14;
    }
  }

  const fileSlug = slugifyFilePart(store?.name || 'loja');
  doc.save(`historico_visita_${visit.id}_${fileSlug}.pdf`);
  return true;
}

/**
 * Gera e baixa uma planilha Excel multi-abas com todo o histórico detalhado de uma visita.
 */
export function exportVisitHistoryExcel(report: VisitReportPayload): boolean {
  const { visit, store, promoter, checklist = [], summary = {} } = report || {};
  if (!visit) return false;

  const wb = XLSX.utils.book_new();
  const appendSheet = (name: string, rows: Record<string, any>[]) => {
    const safeRows = rows.length > 0 ? rows : [{ Informação: 'Sem registros nesta seção' }];
    const ws = XLSX.utils.json_to_sheet(safeRows);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  };

  appendSheet('Resumo', [
    {
      Visita_ID: visit.id,
      Loja: store?.name || '-',
      Endereço: store?.address || '-',
      Promotor: promoter?.name || visit.promoter_name || '-',
      Status: visit.status || '-',
      Data_Agendada: visit.scheduled_date || '-',
      CheckIn: visit.checkin_at || '-',
      CheckOut: visit.checkout_at || '-',
      Duracao_Min: visit.duration_minutes || 0,
      Total_Abastecido_Un: summary.total_replenished_qty || 0,
      Validades_Conferidas: summary.expiries_count ?? (summary.expiries?.length || 0),
      Precificacoes: summary.price_checks_count ?? (summary.price_checks?.length || 0),
      Ocorrencias: summary.occurrences_count ?? (summary.occurrences?.length || 0),
      Rupturas: summary.ruptures_count || 0,
      Problemas: visit.problems_found || '',
      Oportunidades: visit.opportunities_found || '',
      Observacoes: visit.notes || '',
    },
  ]);

  appendSheet(
    'Abastecimento',
    (summary.replenishments || []).map((r: any) => ({
      Produto: r.product_name || '-',
      Gramatura: r.product_weight || '-',
      EAN: r.product_ean || '-',
      Qtd_Abastecida: r.quantity_replenished ?? 0,
      Estoque_Gondola: r.gondola_stock ?? 0,
      Estoque_Retaguarda: r.backroom_stock ?? 0,
      Status: r.status || '-',
      Observacoes: r.notes || '',
      Registrado_Em: r.created_at || '',
    }))
  );

  appendSheet(
    'Validades',
    (summary.expiries || []).map((e: any) => ({
      Produto: e.product_name || '-',
      Gramatura: e.product_weight || '-',
      Lote: e.batch_code || '-',
      Validade: e.expiry_date || '-',
      Quantidade: e.quantity ?? 0,
      Condicao: e.condition || '-',
      PVPS_Aplicado: e.fifo_fefo_applied ? 'Sim' : 'Não',
      Retirada_Solicitada: e.removal_requested ? 'Sim' : 'Não',
    }))
  );

  appendSheet(
    'Precificacao',
    (summary.price_checks || []).map((p: any) => ({
      Produto: p.product_name || '-',
      Gramatura: p.product_weight || '-',
      Preco_Gondola: p.gondola_price ?? '-',
      Preco_Promocional: p.promo_price ?? '-',
      Com_Etiqueta: p.has_price_tag === 0 ? 'Não' : 'Sim',
      Concorrente: p.competitor_name || '-',
      Preco_Concorrente: p.competitor_price ?? '-',
      Observacoes: p.notes || '',
    }))
  );

  appendSheet(
    'Ocorrencias',
    (summary.occurrences || []).map((o: any) => ({
      Tipo: o.type || '-',
      Prioridade: o.priority || '-',
      Status: o.status || '-',
      Produto: o.product_name || '-',
      Descricao: o.description || '-',
      Data: o.created_at || '',
    }))
  );

  appendSheet(
    'Checklist',
    checklist.map((c: any) => ({
      Atividade: c.label || '-',
      Status: c.completed ? 'Concluído' : 'Pendente',
      Atualizado_Em: c.updated_at || '',
    }))
  );

  const evs = summary.evidences || {};
  const allEvs = [
    ...(evs.selfie_entrada || []),
    ...(evs.initial || []),
    ...(evs.complementary || []),
    ...(evs.final || []),
  ];
  appendSheet(
    'Fotos',
    allEvs.map((ev: any) => ({
      Etapa: ev.stage || '-',
      Area: ev.area || '-',
      Panoramica: ev.is_panoramic ? 'Sim' : 'Não',
      Data_Hora: ev.captured_at || '-',
      Legenda: ev.caption || '',
      URL_Foto: ev.photo_url || '',
    }))
  );

  const fileSlug = slugifyFilePart(store?.name || 'loja');
  XLSX.writeFile(wb, `historico_visita_${visit.id}_${fileSlug}.xlsx`);
  return true;
}

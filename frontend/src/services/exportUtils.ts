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
  photos?: Array<{
    photo_url: string;
    stage?: string;
    stage_label?: string;
    area?: string;
    caption?: string;
    captured_at?: string;
    is_panoramic?: boolean;
    data_url?: string;
    width?: number;
    height?: number;
  }>;
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
  const initialCount = evs.initial?.length || 0;
  const finalCount = evs.final?.length || 0;
  const totalPhotos = Math.max(
    report.photos?.length || 0,
    (evs.selfie_entrada?.length || 0) +
      initialCount +
      (evs.complementary?.length || 0) +
      finalCount
  );

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Indicador', 'Total', 'Indicador', 'Total']],
    body: [
      ['Itens Abastecidos', `${summary.replenished_items_count ?? (summary.replenishments?.length || 0)} (${summary.total_replenished_qty || 0} un)`, 'Validades Conferidas', String(summary.expiries_count ?? (summary.expiries?.length || 0))],
      ['Precificações', String(summary.price_checks_count ?? (summary.price_checks?.length || 0)), 'Exposições / Displays', String(summary.displays_count ?? (summary.displays?.length || 0))],
      ['Ocorrências / Rupturas', `${summary.occurrences_count ?? (summary.occurrences?.length || 0)} (${summary.ruptures_count || 0} rupturas)`, 'Checklist Concluído', `${summary.checklist_done || 0} / ${summary.checklist_total || checklist.length}`],
      ['Fotos (Iniciais / Finais)', `${initialCount} inicial(is) • ${finalCount} final(is) (${totalPhotos} total)`, 'Retirados (Vencidos)', `${summary.removed_products_qty || 0} un`],
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

  // 10. Evidências Fotográficas organizadas por etapa (Selfie, Iniciais/Antes, Finais/Depois e Complementares/Extras)
  const fallbackEvidences = [
    ...(evs.selfie_entrada || []).map((p: any) => ({ ...p, stage: 'SELFIE_ENTRADA', stage_label: 'Selfie na Entrada' })),
    ...(evs.initial || []).map((p: any) => ({ ...p, stage: 'INICIAL', stage_label: 'Foto Inicial (Antes)' })),
    ...(evs.final || []).map((p: any) => ({ ...p, stage: 'FINAL', stage_label: 'Foto Final (Depois)' })),
    ...(evs.complementary || []).map((p: any) => ({ ...p, stage: 'COMPLEMENTAR', stage_label: 'Foto Complementar' })),
  ];
  const allEvidences = Array.isArray(report.photos) && report.photos.length > 0 ? report.photos : fallbackEvidences;

  if (allEvidences.length > 0) {
    const fullW = pageW - margin * 2;
    const colW = (fullW - 6) / 2;
    const stdBoxH = 60;
    const panoBoxH = 54;

    const normSt = (ev: any) => String(ev?.stage || '').toUpperCase().trim();
    const rawPhotoGroups: Array<{ title: string; color: [number, number, number]; items: any[] }> = [
      {
        title: 'Selfie na Entrada',
        color: [79, 70, 229],
        items: allEvidences.filter((e) => normSt(e) === 'SELFIE_ENTRADA'),
      },
      {
        title: 'Fotos Iniciais — Antes da Intervenção',
        color: [29, 78, 216],
        items: allEvidences.filter((e) => normSt(e) === 'INICIAL' || normSt(e) === 'EXPOSICAO_ANTES'),
      },
      {
        title: 'Fotos Finais — Depois da Intervenção',
        color: [5, 150, 105],
        items: allEvidences.filter((e) => normSt(e) === 'FINAL' || normSt(e) === 'EXPOSICAO_DEPOIS'),
      },
      {
        title: 'Fotos Complementares & Outros Registros',
        color: [51, 65, 85],
        items: allEvidences.filter(
          (e) => !['SELFIE_ENTRADA', 'INICIAL', 'FINAL', 'EXPOSICAO_ANTES', 'EXPOSICAO_DEPOIS'].includes(normSt(e))
        ),
      },
    ];
    const photoGroups = rawPhotoGroups.filter((g) => g.items.length > 0);

    for (const group of photoGroups) {
      ensureSpace(78);
      doc.setFillColor(group.color[0], group.color[1], group.color[2]);
      doc.roundedRect(margin, y, fullW, 8, 2, 2, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'bold');
      doc.text(`${group.title} (${group.items.length})`, margin + 3.5, y + 5.5);
      y += 11;

      let colIdx = 0;

      for (const ev of group.items) {
        let dataUrl = ev.data_url || '';
        let aspect = ev.width && ev.height ? ev.width / ev.height : 4 / 3;

        if (!dataUrl && ev.photo_url) {
          const loaded = await fetchImageAsJpegDataUrl(ev.photo_url);
          if (loaded) {
            dataUrl = loaded.dataUrl;
            aspect = loaded.aspect;
          }
        }

        const isPano = Boolean(ev.is_panoramic) || aspect >= 2.0;

        if (isPano) {
          if (colIdx === 1) {
            colIdx = 0;
            y += stdBoxH + 16;
          }
          ensureSpace(panoBoxH + 16);
          doc.setDrawColor(203, 213, 225);
          doc.roundedRect(margin, y, fullW, panoBoxH + 12, 2.5, 2.5, 'S');

          if (dataUrl) {
            const maxImgW = fullW - 4;
            const maxImgH = panoBoxH - 2;
            let drawW = maxImgW;
            let drawH = drawW / aspect;
            if (drawH > maxImgH) {
              drawH = maxImgH;
              drawW = drawH * aspect;
            }
            const offsetX = margin + 2 + (maxImgW - drawW) / 2;
            const offsetY = y + 2 + (maxImgH - drawH) / 2;
            doc.addImage(dataUrl, 'JPEG', offsetX, offsetY, drawW, drawH);
          } else {
            doc.setFontSize(8);
            doc.setTextColor(100, 116, 139);
            doc.text('Imagem indisponível offline', margin + 5, y + 26);
          }

          doc.setFontSize(8);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(15, 23, 42);
          const label = `${ev.stage_label || ev.stage || 'Foto'} • ${ev.area || 'PDV'} (Panorâmica)`.slice(0, 95);
          doc.text(label, margin + 3, y + panoBoxH + 5);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(100, 116, 139);
          doc.text(String(ev.captured_at || ''), margin + 3, y + panoBoxH + 9.5);
          y += panoBoxH + 16;
          continue;
        }

        if (colIdx === 0) ensureSpace(stdBoxH + 16);
        const x = margin + colIdx * (colW + 6);

        doc.setDrawColor(203, 213, 225);
        doc.roundedRect(x, y, colW, stdBoxH + 12, 2.5, 2.5, 'S');

        if (dataUrl) {
          const maxImgW = colW - 4;
          const maxImgH = stdBoxH - 2;
          let drawW = maxImgW;
          let drawH = drawW / aspect;
          if (drawH > maxImgH) {
            drawH = maxImgH;
            drawW = drawH * aspect;
          }
          const offsetX = x + 2 + (maxImgW - drawW) / 2;
          const offsetY = y + 2 + (maxImgH - drawH) / 2;
          doc.addImage(dataUrl, 'JPEG', offsetX, offsetY, drawW, drawH);
        } else {
          doc.setFontSize(7.5);
          doc.setTextColor(100, 116, 139);
          doc.text('Imagem registrada no servidor', x + 4, y + 28);
        }

        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 23, 42);
        const label = `${ev.stage_label || ev.stage || 'Foto'} • ${ev.area || 'PDV'}`.slice(0, 50);
        doc.text(label, x + 3, y + stdBoxH + 5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text(String(ev.captured_at || ''), x + 3, y + stdBoxH + 9.5);

        colIdx++;
        if (colIdx === 2) {
          colIdx = 0;
          y += stdBoxH + 16;
        }
      }
      if (colIdx === 1) {
        y += stdBoxH + 16;
      }
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

export interface ExpiryReportRow {
  id: number;
  store_id?: number;
  store_name?: string;
  product_id?: number;
  product_name?: string;
  product_weight?: string;
  product_ean?: string;
  brand_name?: string;
  batch_code?: string;
  expiry_date?: string;
  quantity?: number;
  fifo_fefo_applied?: number | boolean;
  condition?: string;
  removal_requested?: number | boolean;
  is_removed?: boolean;
  estimated_loss?: number;
  promoter_name?: string;
  notes?: string;
  created_at?: string;
}

export function isExpiryItemRemoved(row: ExpiryReportRow): boolean {
  return Boolean(
    row?.is_removed ||
      row?.removal_requested === 1 ||
      row?.removal_requested === true ||
      row?.condition === 'Vencido'
  );
}

function formatBrDate(dateStr?: string): string {
  const s = String(dateStr || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s || '-';
}

/**
 * Gera e baixa o relatório em PDF de Controle de Validades por Loja,
 * incluindo seção destacada de Produtos Retirados com suas quantidades e totais por loja.
 */
export function exportExpiriesPDF(params: {
  rows: ExpiryReportRow[];
  storeLabel?: string;
  filterLabel?: string;
}): boolean {
  const rows = Array.isArray(params?.rows) ? params.rows : [];
  if (rows.length === 0) return false;

  const storeLabel = params.storeLabel || 'Todas as Lojas';
  const filterLabel = params.filterLabel || 'Todas as Condições';

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  let y = 12;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageH - 14) {
      doc.addPage();
      y = 14;
    }
  };

  // Cabeçalho corporativo
  doc.setFillColor(15, 23, 42);
  doc.roundedRect(margin, y, pageW - margin * 2, 24, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13.5);
  doc.setFont('helvetica', 'bold');
  doc.text('MERCHANDISING PRO — Controle de Validades & Retirados', margin + 5, y + 9);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Loja: ${storeLabel}  •  Filtro: ${filterLabel}`, margin + 5, y + 15.5);
  doc.setFontSize(8);
  doc.setTextColor(203, 213, 225);
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}  •  Total de registros: ${rows.length}`, margin + 5, y + 21);
  y += 29;

  // Métricas consolidadas
  const removedRows = rows.filter(isExpiryItemRemoved);
  const totalCheckedQty = rows.reduce((acc, r) => acc + Number(r.quantity || 0), 0);
  const totalRemovedQty = removedRows.reduce((acc, r) => acc + Number(r.quantity || 0), 0);
  const totalLoss = rows.reduce((acc, r) => acc + Number(r.estimated_loss || 0), 0);
  const removedLoss = removedRows.reduce((acc, r) => acc + Number(r.estimated_loss || 0), 0);
  const nearExpiryCount = rows.filter((r) => r.condition === 'Próximo Vencimento').length;
  const expiredCount = rows.filter((r) => r.condition === 'Vencido').length;

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'bold');
  doc.text('1. Resumo Geral', margin, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [['Indicador', 'Quantidade / Valor', 'Indicador', 'Quantidade / Valor']],
    body: [
      ['Registros Conferidos', `${rows.length} item(ns) (${totalCheckedQty} un)`, 'Produtos Retirados', `${removedRows.length} item(ns) (${totalRemovedQty} un)`],
      ['Vencidos / Próx. Vencimento', `${expiredCount} vencido(s) • ${nearExpiryCount} próx.`, 'Perda Estimada Total', `R$ ${totalLoss.toFixed(2)}`],
    ],
    styles: { fontSize: 8.5, cellPadding: 2.2 },
    headStyles: { fillColor: [29, 78, 216] },
  });
  y = ((doc as any).lastAutoTable?.finalY || y + 24) + 7;

  // Agrupamento por loja
  const byStore = new Map<string, ExpiryReportRow[]>();
  for (const r of rows) {
    const sName = String(r.store_name || 'Loja não informada');
    const list = byStore.get(sName) || [];
    list.push(r);
    byStore.set(sName, list);
  }
  const sortedStores = Array.from(byStore.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  // Resumo por loja quando houver mais de 1 loja
  if (sortedStores.length > 1) {
    ensureSpace(32);
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(10.5);
    doc.setFont('helvetica', 'bold');
    doc.text(`2. Consolidado por Loja (${sortedStores.length} lojas)`, margin, y);
    y += 3;

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Loja', 'Conferidos', 'Qtd Total', 'Retirados (Itens)', 'Qtd Retirada', 'Perda (R$)']],
      body: sortedStores.map(([sName, items]) => {
        const sRemoved = items.filter(isExpiryItemRemoved);
        const sTotalQty = items.reduce((acc, i) => acc + Number(i.quantity || 0), 0);
        const sRemQty = sRemoved.reduce((acc, i) => acc + Number(i.quantity || 0), 0);
        const sLoss = items.reduce((acc, i) => acc + Number(i.estimated_loss || 0), 0);
        return [sName, String(items.length), `${sTotalQty} un`, String(sRemoved.length), `${sRemQty} un`, `R$ ${sLoss.toFixed(2)}`];
      }),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [30, 64, 175] },
      columnStyles: {
        4: { fontStyle: 'bold', textColor: [185, 28, 28] },
      },
    });
    y = ((doc as any).lastAutoTable?.finalY || y + 28) + 7;
  }

  // Seção Destacada: Produtos Retirados e Respectivas Quantidades
  ensureSpace(34);
  const removedSecNum = sortedStores.length > 1 ? '3' : '2';
  doc.setFillColor(190, 18, 60);
  doc.roundedRect(margin, y, pageW - margin * 2, 8, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.text(
    `${removedSecNum}. Produtos Retirados da Área de Vendas (${removedRows.length} registros • ${totalRemovedQty} un)`,
    margin + 3.5,
    y + 5.4
  );
  y += 10.5;

  if (removedRows.length > 0) {
    const sortedRemoved = [...removedRows].sort((a, b) => {
      const storeCmp = String(a.store_name || '').localeCompare(String(b.store_name || ''));
      if (storeCmp !== 0) return storeCmp;
      return String(a.expiry_date || '').localeCompare(String(b.expiry_date || ''));
    });

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Loja', 'Produto', 'Gram.', 'Lote', 'Validade', 'Qtd Retirada', 'Condição', 'Perda (R$)']],
      body: [
        ...sortedRemoved.map((r) => [
          r.store_name || '-',
          r.product_name || '-',
          r.product_weight || '-',
          r.batch_code || '-',
          formatBrDate(r.expiry_date),
          `${Number(r.quantity || 0)} un`,
          r.condition || '-',
          `R$ ${Number(r.estimated_loss || 0).toFixed(2)}`,
        ]),
        [
          'TOTAL RETIRADO',
          `${removedRows.length} item(ns)`,
          '',
          '',
          '',
          `${totalRemovedQty} un`,
          '',
          `R$ ${removedLoss.toFixed(2)}`,
        ],
      ],
      styles: { fontSize: 7.5, cellPadding: 1.8 },
      headStyles: { fillColor: [159, 18, 57] },
      columnStyles: {
        5: { fontStyle: 'bold', textColor: [185, 28, 28], halign: 'right' },
        7: { halign: 'right' },
      },
      didParseCell: (hookData) => {
        if (hookData.section === 'body' && hookData.row.index === sortedRemoved.length) {
          hookData.cell.styles.fontStyle = 'bold';
          hookData.cell.styles.fillColor = [254, 226, 226];
          hookData.cell.styles.textColor = [127, 29, 29];
        }
      },
    });
    y = ((doc as any).lastAutoTable?.finalY || y + 30) + 8;
  } else {
    doc.setTextColor(71, 85, 105);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.text('Nenhum produto retirado registrado para o filtro selecionado.', margin + 2, y + 3);
    y += 10;
  }

  // Tabela Completa de Validades Agrupada por Loja
  ensureSpace(32);
  const tableSecNum = sortedStores.length > 1 ? '4' : '3';
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'bold');
  doc.text(`${tableSecNum}. Tabela Detalhada de Validades por Loja`, margin, y);
  y += 5;

  for (const [sName, items] of sortedStores) {
    ensureSpace(30);
    const sTotalQty = items.reduce((acc, i) => acc + Number(i.quantity || 0), 0);
    const sRemQty = items.filter(isExpiryItemRemoved).reduce((acc, i) => acc + Number(i.quantity || 0), 0);

    doc.setFillColor(241, 245, 249);
    doc.roundedRect(margin, y, pageW - margin * 2, 7.5, 1.5, 1.5, 'F');
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.text(`${sName}  —  ${items.length} registro(s) • ${sTotalQty} un conferidas • ${sRemQty} un retiradas`, margin + 3, y + 5);
    y += 9.5;

    const sortedItems = [...items].sort((a, b) => String(a.expiry_date || '').localeCompare(String(b.expiry_date || '')));
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Validade', 'Produto', 'Gram.', 'Lote', 'Qtd', 'Condição', 'Retirado', 'PVPS', 'Perda (R$)']],
      body: sortedItems.map((r) => {
        const rem = isExpiryItemRemoved(r);
        return [
          formatBrDate(r.expiry_date),
          r.product_name || '-',
          r.product_weight || '-',
          r.batch_code || '-',
          `${Number(r.quantity || 0)} un`,
          r.condition || '-',
          rem ? `Sim (${Number(r.quantity || 0)} un)` : 'Não',
          r.fifo_fefo_applied ? 'Sim' : 'Não',
          `R$ ${Number(r.estimated_loss || 0).toFixed(2)}`,
        ];
      }),
      styles: { fontSize: 7.3, cellPadding: 1.7 },
      headStyles: { fillColor: [51, 65, 85] },
      columnStyles: {
        4: { halign: 'right' },
        6: { fontStyle: 'bold' },
        8: { halign: 'right' },
      },
      didParseCell: (hookData) => {
        if (hookData.section === 'body' && hookData.column.index === 6) {
          const val = String(hookData.cell.raw || '');
          if (val.startsWith('Sim')) {
            hookData.cell.styles.textColor = [185, 28, 28];
          } else {
            hookData.cell.styles.textColor = [100, 116, 139];
          }
        }
      },
    });
    y = ((doc as any).lastAutoTable?.finalY || y + 24) + 6;
  }

  const slug = slugifyFilePart(storeLabel);
  const dateStamp = new Date().toISOString().slice(0, 10);
  doc.save(`validades_retirados_${slug}_${dateStamp}.pdf`);
  return true;
}

/**
 * Gera e baixa planilha Excel (tabela) multi-abas com Resumo por Loja,
 * Produtos Retirados e Tabela Completa de Validades.
 */
export function exportExpiriesExcel(params: { rows: ExpiryReportRow[]; storeLabel?: string }): boolean {
  const rows = Array.isArray(params?.rows) ? params.rows : [];
  if (rows.length === 0) return false;

  const storeLabel = params.storeLabel || 'todas_as_lojas';
  const wb = XLSX.utils.book_new();
  const appendSheet = (name: string, data: Record<string, any>[]) => {
    const safe = data.length > 0 ? data : [{ Informação: 'Sem registros para o filtro selecionado' }];
    const ws = XLSX.utils.json_to_sheet(safe);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  };

  // Aba 1: Resumo por Loja
  const byStore = new Map<string, ExpiryReportRow[]>();
  for (const r of rows) {
    const sName = String(r.store_name || 'Loja não informada');
    const list = byStore.get(sName) || [];
    list.push(r);
    byStore.set(sName, list);
  }
  const summaryRows = Array.from(byStore.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([sName, items]) => {
      const removed = items.filter(isExpiryItemRemoved);
      return {
        Loja: sName,
        Registros_Conferidos: items.length,
        Qtd_Total_Conferida: items.reduce((acc, i) => acc + Number(i.quantity || 0), 0),
        Itens_Retirados: removed.length,
        Qtd_Total_Retirada: removed.reduce((acc, i) => acc + Number(i.quantity || 0), 0),
        Vencidos: items.filter((i) => i.condition === 'Vencido').length,
        Proximo_Vencimento: items.filter((i) => i.condition === 'Próximo Vencimento').length,
        Avarias_Danificados: items.filter((i) => i.condition === 'Avaria' || i.condition === 'Embalagem Danificada').length,
        Perda_Estimada_RS: Number(items.reduce((acc, i) => acc + Number(i.estimated_loss || 0), 0).toFixed(2)),
      };
    });
  appendSheet('Resumo_por_Loja', summaryRows);

  // Aba 2: Produtos Retirados
  const removedRows = rows
    .filter(isExpiryItemRemoved)
    .sort((a, b) => String(a.store_name || '').localeCompare(String(b.store_name || '')) || String(a.expiry_date || '').localeCompare(String(b.expiry_date || '')))
    .map((r) => ({
      Loja: r.store_name || '-',
      Validade: formatBrDate(r.expiry_date),
      Produto: r.product_name || '-',
      Gramatura: r.product_weight || '-',
      EAN: r.product_ean || '-',
      Lote: r.batch_code || '-',
      Qtd_Retirada: Number(r.quantity || 0),
      Condicao: r.condition || '-',
      Perda_Estimada_RS: Number(r.estimated_loss || 0),
      Promotor: r.promoter_name || '-',
      Observacoes: r.notes || '',
      Registrado_Em: r.created_at || '',
    }));
  appendSheet('Produtos_Retirados', removedRows);

  // Aba 3: Tabela Completa de Validades por Loja
  const allRows = [...rows]
    .sort((a, b) => String(a.store_name || '').localeCompare(String(b.store_name || '')) || String(a.expiry_date || '').localeCompare(String(b.expiry_date || '')))
    .map((r) => {
      const rem = isExpiryItemRemoved(r);
      return {
        Loja: r.store_name || '-',
        Validade: formatBrDate(r.expiry_date),
        Produto: r.product_name || '-',
        Gramatura: r.product_weight || '-',
        EAN: r.product_ean || '-',
        Lote: r.batch_code || '-',
        Quantidade: Number(r.quantity || 0),
        Condicao: r.condition || '-',
        Retirado: rem ? 'Sim' : 'Não',
        Qtd_Retirada: rem ? Number(r.quantity || 0) : 0,
        FIFO_FEFO: r.fifo_fefo_applied ? 'Sim' : 'Não',
        Perda_Estimada_RS: Number(r.estimated_loss || 0),
        Promotor: r.promoter_name || '-',
        Observacoes: r.notes || '',
        Registrado_Em: r.created_at || '',
      };
    });
  appendSheet('Validades_por_Loja', allRows);

  const slug = slugifyFilePart(storeLabel);
  const dateStamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `validades_retirados_${slug}_${dateStamp}.xlsx`);
  return true;
}

import React, { useEffect, useState } from 'react';
import { FileText, FileSpreadsheet, Users, Shield, Package, Tags } from 'lucide-react';
import { apiFetch } from '../services/api';
import { exportToExcel, exportToPDF } from '../services/exportUtils';
import { useAuth } from '../context/AuthContext';

const REPORT_TYPES = [
  { id: 'lojas', title: 'Relatório Individual por Loja' },
  { id: 'visitas', title: 'Relatório de Visitas' },
  { id: 'fotografico', title: 'Relatório Fotográfico' },
  { id: 'rupturas', title: 'Relatório de Ruptura' },
  { id: 'abastecimento', title: 'Relatório de Abastecimento' },
  { id: 'validade', title: 'Relatório de Validade' },
  { id: 'precificacao', title: 'Relatório de Precificação' },
  { id: 'concorrencia', title: 'Relatório de Concorrência' },
  { id: 'planograma', title: 'Relatório de Planograma' },
  { id: 'campanhas', title: 'Relatório de Campanhas' },
  { id: 'produtividade', title: 'Relatório de Produtividade' },
  { id: 'consolidado', title: 'Relatório Consolidado por Período' },
];

export const ReportsAndSettingsPage: React.FC<{ mode: 'relatorios' | 'configuracoes' }> = ({ mode }) => {
  const { user } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [previewRows, setPreviewRows] = useState<any[] | null>(null);
  const [previewTitle, setPreviewTitle] = useState('');

  const [newBrand, setNewBrand] = useState({ name: '', is_own: true });
  const [newProd, setNewProd] = useState({ sku: '', ean: '', name: '', brand_id: '1', category: 'Salgadinhos', system_price: '' });
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'promotor', region: 'Centro' });

  const loadConfig = async () => {
    const [b, p] = await Promise.all([apiFetch('/brands'), apiFetch('/products')]);
    setBrands(b);
    setProducts(p);
    if (user?.role === 'admin' || user?.role === 'supervisor') {
      const [u, l] = await Promise.all([apiFetch('/auth/users'), apiFetch('/auth/audit-logs')]);
      setUsers(u);
      setLogs(l);
    }
  };

  useEffect(() => {
    if (mode === 'configuracoes') loadConfig();
  }, [mode]);

  const handleExport = async (repId: string, repTitle: string, format: 'pdf' | 'excel') => {
    const rows = await apiFetch<any[]>(`/reports/${repId}`);
    if (format === 'pdf') exportToPDF(rows, repTitle, `merchandising_${repId}`);
    else exportToExcel(rows, `merchandising_${repId}`, repId);
  };

  const handlePreview = async (repId: string, repTitle: string) => {
    const rows = await apiFetch<any[]>(`/reports/${repId}`);
    setPreviewTitle(repTitle);
    setPreviewRows(rows);
  };

  if (mode === 'relatorios') {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Relatórios Gerenciais (PDF & Excel)</h1>
          <p className="text-sm text-slate-500">Exporte todos os indicadores operacionais e estratégicos com dados reais do PDV</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {REPORT_TYPES.map((r) => (
            <div key={r.id} className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3">
              <div className="font-bold text-sm text-slate-800">{r.title}</div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => handleExport(r.id, r.title, 'pdf')}
                  className="flex-1 py-2 px-3 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5"
                >
                  <FileText className="w-3.5 h-3.5" /> PDF
                </button>
                <button
                  onClick={() => handleExport(r.id, r.title, 'excel')}
                  className="flex-1 py-2 px-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
                </button>
                <button
                  onClick={() => handlePreview(r.id, r.title)}
                  className="py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl"
                >
                  Ver
                </button>
              </div>
            </div>
          ))}
        </div>

        {previewRows && (
          <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3 overflow-x-auto">
            <div className="flex justify-between items-center">
              <h2 className="font-bold text-slate-800">{previewTitle} ({previewRows.length} registros)</h2>
              <button onClick={() => setPreviewRows(null)} className="text-xs text-slate-500 hover:underline">Fechar</button>
            </div>
            {previewRows.length === 0 ? (
              <div className="text-sm text-slate-500">Nenhum registro encontrado.</div>
            ) : (
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b uppercase text-slate-500">
                  <tr>{Object.keys(previewRows[0]).map((k) => <th key={k} className="px-3 py-2">{k}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {previewRows.slice(0, 20).map((row, idx) => (
                    <tr key={idx}>
                      {Object.values(row).map((v: any, j) => <td key={j} className="px-3 py-2">{v ?? '-'}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900">Configurações, Cadastros & Auditoria</h1>
        <p className="text-sm text-slate-500">Controle de marcas, produtos (EAN), usuários, perfis de acesso e histórico de alterações</p>
      </div>

      {/* Brands & Products */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3">
          <div className="font-bold text-sm text-slate-800 flex items-center gap-2"><Tags className="w-4 h-4 text-blue-600" /> Marcas Cadastradas</div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiFetch('/brands', { method: 'POST', body: JSON.stringify(newBrand) });
              setNewBrand({ name: '', is_own: true });
              loadConfig();
            }}
            className="flex gap-2"
          >
            <input required placeholder="Nome da marca" value={newBrand.name} onChange={(e) => setNewBrand({ ...newBrand, name: e.target.value })} className="flex-1 px-3 py-2 border rounded-xl text-xs" />
            <select value={newBrand.is_own ? '1' : '0'} onChange={(e) => setNewBrand({ ...newBrand, is_own: e.target.value === '1' })} className="px-2 py-2 border rounded-xl text-xs">
              <option value="1">Própria</option>
              <option value="0">Concorrente</option>
            </select>
            <button type="submit" className="px-3 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold">+</button>
          </form>
          <div className="flex flex-wrap gap-2">
            {brands.map((b) => (
              <span key={b.id} className={`px-3 py-1 rounded-full text-xs font-bold ${b.is_own ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                {b.name} ({b.is_own ? 'Própria' : 'Concorrente'})
              </span>
            ))}
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3">
          <div className="font-bold text-sm text-slate-800 flex items-center gap-2"><Package className="w-4 h-4 text-emerald-600" /> Novo Produto (Catálogo)</div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiFetch('/products', { method: 'POST', body: JSON.stringify({ ...newProd, brand_id: Number(newProd.brand_id), system_price: Number(newProd.system_price) }) });
              setNewProd({ sku: '', ean: '', name: '', brand_id: '1', category: 'Salgadinhos', system_price: '' });
              loadConfig();
            }}
            className="grid grid-cols-2 gap-2"
          >
            <input required placeholder="SKU" value={newProd.sku} onChange={(e) => setNewProd({ ...newProd, sku: e.target.value })} className="px-3 py-2 border rounded-xl text-xs" />
            <input required placeholder="EAN / Cód. Barras" value={newProd.ean} onChange={(e) => setNewProd({ ...newProd, ean: e.target.value })} className="px-3 py-2 border rounded-xl text-xs" />
            <input required placeholder="Nome do Produto" value={newProd.name} onChange={(e) => setNewProd({ ...newProd, name: e.target.value })} className="col-span-2 px-3 py-2 border rounded-xl text-xs" />
            <input required placeholder="Categoria" value={newProd.category} onChange={(e) => setNewProd({ ...newProd, category: e.target.value })} className="px-3 py-2 border rounded-xl text-xs" />
            <input type="number" step="0.01" placeholder="Preço Sistema" value={newProd.system_price} onChange={(e) => setNewProd({ ...newProd, system_price: e.target.value })} className="px-3 py-2 border rounded-xl text-xs" />
            <button type="submit" className="col-span-2 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold">Cadastrar Produto ({products.length} ativos)</button>
          </form>
        </div>
      </div>

      {/* Admin Users */}
      {user?.role === 'admin' && (
        <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-4">
          <div className="font-bold text-sm text-slate-800 flex items-center gap-2"><Users className="w-4 h-4 text-indigo-600" /> Gestão de Usuários & Perfis</div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiFetch('/auth/users', { method: 'POST', body: JSON.stringify(newUser) });
              setNewUser({ name: '', email: '', password: '', role: 'promotor', region: 'Centro' });
              loadConfig();
            }}
            className="grid grid-cols-1 sm:grid-cols-5 gap-2"
          >
            <input required placeholder="Nome" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} className="px-3 py-2 border rounded-xl text-xs" />
            <input required type="email" placeholder="E-mail" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className="px-3 py-2 border rounded-xl text-xs" />
            <input required type="password" placeholder="Senha" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} className="px-3 py-2 border rounded-xl text-xs" />
            <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} className="px-3 py-2 border rounded-xl text-xs">
              <option value="promotor">Promotor</option>
              <option value="supervisor">Supervisor</option>
              <option value="admin">Administrador</option>
            </select>
            <button type="submit" className="px-3 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold">Adicionar</button>
          </form>
          <div className="divide-y text-xs">
            {users.map((u) => (
              <div key={u.id} className="py-2 flex justify-between">
                <span><b>{u.name}</b> ({u.email}) — {u.region}</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 font-bold uppercase">{u.role}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audit Logs */}
      {(user?.role === 'admin' || user?.role === 'supervisor') && (
        <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3">
          <div className="font-bold text-sm text-slate-800 flex items-center gap-2"><Shield className="w-4 h-4 text-slate-600" /> Histórico de Alterações (Auditoria)</div>
          <div className="max-h-60 overflow-y-auto divide-y text-xs">
            {logs.map((l) => (
              <div key={l.id} className="py-2 flex justify-between gap-2">
                <span><b>{l.user_name}</b> • {l.action} em <i>{l.entity}</i>: {l.details}</span>
                <span className="text-slate-400 shrink-0">{l.created_at}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

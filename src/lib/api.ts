import { supabase } from './supabase'

export type ColType = 'text' | 'integer' | 'numeric' | 'boolean' | 'date' | 'timestamp'
export type Column = { name: string; type: ColType; label?: string }
export type Workspace = { id: string; name: string }
export type Project = { id: string; workspace_id: string; name: string; description: string | null }
export type DataTable = { id: string; name: string; label: string; columns: Column[] }
export type Dashboard = { id: string; project_id: string; name: string }
export type ChartType = 'kpi' | 'bar' | 'line' | 'pie' | 'table'
export type Agg = 'count' | 'sum' | 'avg' | 'min' | 'max'
export type Widget = {
  id: string; dashboard_id: string; title: string; chart_type: ChartType; table_name: string
  group_by: string | null; date_trunc: string | null; agg: Agg; metric_column: string | null; position: number
}
export type Row = Record<string, unknown> & { id: number }
export type Point = { label: string; value: number }

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}
async function q<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data as T
}

export const api = {
  workspaces: () => q<Workspace[]>(supabase.from('workspaces').select('id,name').order('created_at')),
  createWorkspace: (name: string) => rpc<string>('create_workspace', { p_name: name }),
  projects: (ws: string) => q<Project[]>(supabase.from('projects').select('*').eq('workspace_id', ws).order('created_at')),
  project: (id: string) => q<Project>(supabase.from('projects').select('*').eq('id', id).single()),
  createProject: (ws: string, name: string, description?: string) =>
    rpc<string>('create_project', { p_workspace: ws, p_name: name, p_description: description ?? null }),
  deleteProject: (p: string) => rpc<void>('delete_project', { p }),

  tables: (p: string) => q<DataTable[]>(supabase.from('project_tables').select('id,name,label,columns').eq('project_id', p).order('created_at')),
  createTable: (p: string, name: string, label: string, columns: Column[]) =>
    rpc<void>('create_table', { p, p_name: name, p_label: label, p_columns: columns }),
  dropTable: (p: string, name: string) => rpc<void>('drop_table', { p, p_name: name }),

  listRows: (p: string, table: string, limit = 100, offset = 0, order = 'id', desc = true) =>
    rpc<{ rows: Row[]; total: number; columns: Column[] }>('list_rows', { p, p_table: table, p_limit: limit, p_offset: offset, p_order: order, p_desc: desc }),
  insertRows: (p: string, table: string, rows: Record<string, unknown>[]) => rpc<number>('insert_rows', { p, p_table: table, p_rows: rows }),
  updateRow: (p: string, table: string, id: number, data: Record<string, unknown>) => rpc<void>('update_row', { p, p_table: table, p_id: id, p_data: data }),
  deleteRows: (p: string, table: string, ids: number[]) => rpc<void>('delete_rows', { p, p_table: table, p_ids: ids }),

  aggregate: (p: string, w: Pick<Widget, 'table_name' | 'agg' | 'metric_column' | 'group_by' | 'date_trunc'>) =>
    rpc<Point[]>('aggregate', { p, p_table: w.table_name, p_agg: w.agg, p_metric: w.metric_column, p_group: w.group_by, p_trunc: w.date_trunc }),

  dashboards: (p: string) => q<Dashboard[]>(supabase.from('dashboards').select('*').eq('project_id', p).order('created_at')),
  createDashboard: (p: string, name: string) => q<Dashboard>(supabase.from('dashboards').insert({ project_id: p, name }).select().single()),
  deleteDashboard: (id: string) => q<null>(supabase.from('dashboards').delete().eq('id', id)),
  widgets: (d: string) => q<Widget[]>(supabase.from('widgets').select('*').eq('dashboard_id', d).order('position')),
  saveWidget: (w: Omit<Widget, 'id'> & { id?: string }) =>
    w.id ? q<Widget>(supabase.from('widgets').update(w).eq('id', w.id).select().single())
         : q<Widget>(supabase.from('widgets').insert(w).select().single()),
  deleteWidget: (id: string) => q<null>(supabase.from('widgets').delete().eq('id', id)),
}

/** Converte um texto em identificador SQL válido: "Valor Total" -> "valor_total" */
export function slug(s: string) {
  const v = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)
  return /^[a-z_]/.test(v) ? v : `c_${v}`
}

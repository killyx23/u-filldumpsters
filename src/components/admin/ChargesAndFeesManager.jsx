import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronUp, ChevronsUpDown, Loader2, Save } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const REQUIRED_FEES = [
  {
    fee_key: 'overload_fee',
    fee_name: 'Overload Fee',
    fee_description:
      'Flat dollar amount charged when a dumpster or trailer is loaded past the weight limit or the heavy-material height limit.',
    fee_value: '150.00',
    is_percentage: false,
  },
  {
    fee_key: 'environmental_cleanup_fee',
    fee_name: 'Environmental Clean-up Fee',
    fee_description:
      'Flat dollar amount charged when prohibited or hazardous materials are found in the equipment, before the actual disposal cost.',
    fee_value: '250.00',
    is_percentage: false,
  },
];

const compareNames = (a, b) =>
  String(a.fee_name || '').localeCompare(String(b.fee_name || ''), undefined, {
    sensitivity: 'base',
    numeric: false,
  });

const compareValues = (a, b, direction) => {
  const aNum = Number.parseFloat(a.fee_value);
  const bNum = Number.parseFloat(b.fee_value);
  const aMissing = Number.isNaN(aNum);
  const bMissing = Number.isNaN(bNum);
  if (aMissing || bMissing) {
    if (aMissing && bMissing) return compareNames(a, b);
    return aMissing ? 1 : -1;
  }
  if (aNum !== bNum) return direction === 'desc' ? bNum - aNum : aNum - bNum;
  return compareNames(a, b);
};

const sortFeeRows = (rows, sort = { key: 'default', direction: 'asc' }) => {
  if (sort.key === 'name') {
    const direction = sort.direction === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => compareNames(a, b) * direction);
  }
  if (sort.key === 'value') {
    return [...rows].sort((a, b) => compareValues(a, b, sort.direction));
  }
  return [...rows].sort((a, b) => {
    if (a.fee_key === 'overload_fee') return -1;
    if (b.fee_key === 'overload_fee') return 1;
    return compareNames(a, b);
  });
};

const toEditableRows = (rows) => {
  const normalized = (rows || []).map((row) => ({
    ...row,
    fee_name: row.fee_name || '',
    fee_description: row.fee_description || '',
    fee_value:
      row.fee_value === null || row.fee_value === undefined
        ? ''
        : String(row.fee_value),
    isNew: false,
  }));
  const present = new Set(normalized.map((row) => row.fee_key));
  const missing = REQUIRED_FEES.filter((fee) => !present.has(fee.fee_key)).map((fee) => ({
    ...fee,
    id: `new-${fee.fee_key}`,
    isNew: true,
  }));
  return sortFeeRows([...normalized, ...missing]);
};

const SORT_LABELS = {
  name: {
    asc: 'A to Z',
    desc: 'Z to A',
  },
  value: {
    asc: 'least to greatest',
    desc: 'greatest to least',
  },
};

const SortableHeader = ({ label, column, sort, onSort }) => {
  const active = sort.key === column;
  const direction = active ? sort.direction : 'asc';
  const nextDirection = active && sort.direction === 'asc' ? 'desc' : 'asc';
  const Icon = !active ? ChevronsUpDown : direction === 'asc' ? ChevronUp : ChevronDown;

  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className="inline-flex items-center gap-1 text-blue-200 hover:text-white"
      aria-label={`Sort by ${label}, ${SORT_LABELS[column][nextDirection]}`}
    >
      {label}
      <Icon className={`h-4 w-4 ${active ? 'text-white' : 'text-blue-200/60'}`} aria-hidden="true" />
    </button>
  );
};

export const ChargesAndFeesManager = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState([]);
  const [originalRows, setOriginalRows] = useState([]);
  const [sort, setSort] = useState({ key: 'default', direction: 'asc' });

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('charges_and_fees')
        .select('*');

      if (error) throw error;

      const normalized = toEditableRows(data);
      setRows(normalized);
      setOriginalRows(normalized);
    } catch (error) {
      const missingTable =
        error?.code === '42P01' ||
        String(error?.message || '').toLowerCase().includes('does not exist');
      toast({
        title: 'Failed to load charges and fees',
        description: missingTable
          ? 'The charges_and_fees table is not available in this environment yet. Apply the latest Supabase migrations, then reload this page.'
          : error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const dirtyIds = useMemo(() => {
    const originalById = new Map(originalRows.map((row) => [row.id, row]));
    return rows
      .filter((row) => {
        const original = originalById.get(row.id);
        if (!original || row.isNew) return true;
        return (
          row.fee_name !== original.fee_name ||
          row.fee_description !== original.fee_description ||
          row.fee_value !== original.fee_value
        );
      })
      .map((row) => row.id);
  }, [rows, originalRows]);

  const hasChanges = dirtyIds.length > 0;
  const displayRows = useMemo(() => sortFeeRows(rows, sort), [rows, sort]);

  const toggleSort = (column) => {
    setSort((current) => {
      if (current.key === column) {
        return { key: column, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key: column, direction: 'asc' };
    });
  };

  const updateCell = (id, field, value) => {
    setRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
  };

  const handleSaveAll = async () => {
    if (!hasChanges) return;
    setSaving(true);
    try {
      const dirtyRows = rows.filter((row) => dirtyIds.includes(row.id));

      for (const row of dirtyRows) {
        const parsedValue = Number.parseFloat(row.fee_value);
        if (Number.isNaN(parsedValue)) {
          throw new Error(`Invalid value for "${row.fee_name}". Use a numeric value.`);
        }

        const payload = {
          fee_name: row.fee_name.trim(),
          fee_description: row.fee_description.trim(),
          fee_value: parsedValue,
          is_percentage: Boolean(row.is_percentage),
          updated_at: new Date().toISOString(),
        };
        const query = row.isNew
          ? supabase.from('charges_and_fees').insert({
              ...payload,
              fee_key: row.fee_key,
            })
          : supabase.from('charges_and_fees').update(payload).eq('id', row.id);
        const { error } = await query;

        if (error) throw error;
      }

      toast({
        title: 'Charges and fees updated',
        description: `Saved ${dirtyRows.length} ${dirtyRows.length === 1 ? 'item' : 'items'}.`,
      });
      await fetchRows();
    } catch (error) {
      toast({
        title: 'Failed to save changes',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-12 w-12 animate-spin text-yellow-400" />
      </div>
    );
  }

  return (
    <div className="bg-white/10 p-6 rounded-2xl border border-white/20 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Charges and Fees</h2>
          <p className="text-sm text-blue-200">
            Each fee has a name, a description, and a value. Percentage fees use %. Dollar fees use $.
          </p>
        </div>
        <Button
          onClick={handleSaveAll}
          disabled={!hasChanges || saving}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Update / Save Changes
            </>
          )}
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="border-white/20">
            <TableHead
              className="text-blue-200 w-[240px]"
              aria-sort={sort.key === 'name' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
            >
              <SortableHeader label="Name" column="name" sort={sort} onSort={toggleSort} />
            </TableHead>
            <TableHead className="text-blue-200">Description</TableHead>
            <TableHead
              className="text-blue-200 w-[220px]"
              aria-sort={sort.key === 'value' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
            >
              <SortableHeader label="Value" column="value" sort={sort} onSort={toggleSort} />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayRows.map((row) => (
            <TableRow key={row.id} className="border-white/10">
              <TableCell>
                <Input
                  value={row.fee_name}
                  onChange={(e) => updateCell(row.id, 'fee_name', e.target.value)}
                  className="bg-white/10 text-white border-white/20"
                />
              </TableCell>
              <TableCell>
                <Input
                  value={row.fee_description}
                  onChange={(e) =>
                    updateCell(row.id, 'fee_description', e.target.value)
                  }
                  className="bg-white/10 text-white border-white/20"
                />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-300 min-w-4" title={row.is_percentage ? 'Percentage' : 'Dollar amount'}>
                    {row.is_percentage ? '%' : '$'}
                  </span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    aria-label={row.is_percentage ? `${row.fee_name} percentage` : `${row.fee_name} dollar amount`}
                    value={row.fee_value}
                    onChange={(e) => updateCell(row.id, 'fee_value', e.target.value)}
                    className="bg-white/10 text-white border-white/20"
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default ChargesAndFeesManager;

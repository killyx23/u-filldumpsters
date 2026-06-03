import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Save } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const toEditableRows = (rows) =>
  (rows || []).map((row) => ({
    ...row,
    fee_name: row.fee_name || '',
    fee_description: row.fee_description || '',
    fee_value:
      row.fee_value === null || row.fee_value === undefined
        ? ''
        : String(row.fee_value),
  }));

export const ChargesAndFeesManager = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState([]);
  const [originalRows, setOriginalRows] = useState([]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('charges_and_fees')
        .select('*')
        .order('fee_name', { ascending: true });

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
        if (!original) return false;
        return (
          row.fee_name !== original.fee_name ||
          row.fee_description !== original.fee_description ||
          row.fee_value !== original.fee_value
        );
      })
      .map((row) => row.id);
  }, [rows, originalRows]);

  const hasChanges = dirtyIds.length > 0;

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

        const { error } = await supabase
          .from('charges_and_fees')
          .update({
            fee_name: row.fee_name.trim(),
            fee_description: row.fee_description.trim(),
            fee_value: parsedValue,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);

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
            Configure dynamic values used across agreements and checkout calculations.
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
            <TableHead className="text-blue-200">Name</TableHead>
            <TableHead className="text-blue-200">Description</TableHead>
            <TableHead className="text-blue-200 w-[180px]">Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
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
                  <span className="text-sm text-gray-300 min-w-4">
                    {row.is_percentage ? '%' : '$'}
                  </span>
                  <Input
                    type="number"
                    step="0.01"
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

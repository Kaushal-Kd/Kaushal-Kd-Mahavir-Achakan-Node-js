import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import Button from '../../../components/ui/Button.jsx';
import Input from '../../../components/ui/Input.jsx';
import { configurationsApi } from '../../../lib/api/configurations.js';
import { toast } from '../../../stores/uiStore.js';
import { Section } from '../../settings/tabs/_Tab.jsx';

const LaundryPriorityEditor = () => {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['config-laundry-priority'],
    queryFn: () => configurationsApi.getLaundryPriority(),
  });
  const serverUrgent = Number(data?.data?.urgent_max_days ?? 1);
  const serverHigh = Number(data?.data?.high_max_days ?? 3);
  const serverMedium = Number(data?.data?.medium_max_days ?? 7);
  const [urgentInput, setUrgentInput] = useState('');
  const [highInput, setHighInput] = useState('');
  const [mediumInput, setMediumInput] = useState('');

  useEffect(() => {
    setUrgentInput(String(Math.max(0, Math.floor(Number.isFinite(serverUrgent) ? serverUrgent : 1))));
  }, [serverUrgent]);

  useEffect(() => {
    setHighInput(String(Math.max(0, Math.floor(Number.isFinite(serverHigh) ? serverHigh : 3))));
  }, [serverHigh]);

  useEffect(() => {
    setMediumInput(String(Math.max(0, Math.floor(Number.isFinite(serverMedium) ? serverMedium : 7))));
  }, [serverMedium]);

  const parsedUrgent = useMemo(() => Math.max(0, Math.floor(Number(urgentInput) || 0)), [urgentInput]);
  const parsedHigh = useMemo(() => Math.max(0, Math.floor(Number(highInput) || 0)), [highInput]);
  const parsedMedium = useMemo(() => Math.max(0, Math.floor(Number(mediumInput) || 0)), [mediumInput]);
  const isDirty =
    parsedUrgent !== serverUrgent || parsedHigh !== serverHigh || parsedMedium !== serverMedium;
  const orderValid = parsedUrgent <= parsedHigh && parsedHigh <= parsedMedium;

  const saveMut = useMutation({
    mutationFn: () =>
      configurationsApi.updateLaundryPriority({
        urgent_max_days: parsedUrgent,
        high_max_days: parsedHigh,
        medium_max_days: parsedMedium,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['config-laundry-priority'] });
      toast.success('Laundry priority settings saved');
    },
    onError: (e) => toast.error(e.response?.data?.error?.message || 'Save failed'),
  });

  return (
    <Section
      title="Laundry Priority"
      description="Days-until-next-pickup thresholds for Urgent, High, Medium, and Low in the washing queue and laundry jobs"
      actions={
        <Button
          icon={Save}
          size="sm"
          onClick={() => saveMut.mutate()}
          loading={saveMut.isPending}
          disabled={!isDirty || !orderValid}
        >
          Save changes
        </Button>
      }
    >
      {isLoading ? (
        <div className="text-sm text-gray-400 py-4 text-center">Loading…</div>
      ) : (
        <div className="max-w-sm space-y-4">
          <Input
            label="Urgent (days left)"
            type="number"
            min={0}
            step={1}
            value={urgentInput}
            onChange={(e) => setUrgentInput(e.target.value)}
            hint="Priority is Urgent when days left is at or below this value."
          />
          <Input
            label="High (days left)"
            type="number"
            min={0}
            step={1}
            value={highInput}
            onChange={(e) => setHighInput(e.target.value)}
            hint="Priority is High when days left is above Urgent and at or below this value."
          />
          <Input
            label="Medium (days left)"
            type="number"
            min={0}
            step={1}
            value={mediumInput}
            onChange={(e) => setMediumInput(e.target.value)}
            hint="Priority is Medium when days left is above High and at or below this value. Anything above is Low."
          />
          {!orderValid ? (
            <p className="text-xs text-red-600">Urgent must be less than or equal to High, and High less than or equal to Medium.</p>
          ) : null}
        </div>
      )}
    </Section>
  );
};

export default LaundryPriorityEditor;

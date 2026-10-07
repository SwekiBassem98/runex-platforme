'use client';

/**
 * Catalogue des composants du design system.
 * Écran de démonstration migré depuis l'application Vite.
 */

import React from 'react';
import {
  Badge,
  Card,
  Checkbox,
  FormField,
  Input,
  PageHeader,
  Select,
  StatusIndicator,
  Switch,
  useToast,
} from '@logixpress/ui';

export default function DesignSystemPage() {
  const { addToast } = useToast();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Catalogue des Composants du Design System"
        description="Bibliothèque des composants réutilisables de la plateforme RUNEX."
        breadcrumbs={[{ label: 'Design System' }, { label: 'Catalogue', active: true }]}
      />

      <div className="p-6 space-y-6">
        <Card title="1. Badges &amp; Indicateurs d'État" subtitle="Variants et badges avec points pulsants">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 items-center">
              <Badge variant="default">Default</Badge>
              <Badge variant="primary">Primary (Red)</Badge>
              <Badge variant="secondary">Secondary (Dark)</Badge>
              <Badge variant="success">Success</Badge>
              <Badge variant="warning">Warning</Badge>
              <Badge variant="danger">Danger</Badge>
              <Badge variant="outline">Outline</Badge>
            </div>

            <div className="flex flex-wrap gap-6 pt-3 border-t border-slate-100 items-center">
              <StatusIndicator status="online" pulse label="Connecté (Live)" />
              <StatusIndicator status="transit" pulse label="En Transit Inter-Dépôt" />
              <StatusIndicator status="busy" label="Occupé en tournée" />
              <StatusIndicator status="alert" pulse label="Alerte Retard" />
              <StatusIndicator status="offline" label="Déconnecté" />
            </div>
          </div>
        </Card>

        <Card title="2. Éléments de Formulaire" subtitle="Inputs, Select, Switch et Checkbox alignés sur la charte">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormField label="Champ texte standard" helpText="Exemple de texte d'aide">
              <Input placeholder="Entrez une valeur…" />
            </FormField>

            <FormField label="Champ avec erreur" error="Ce champ est obligatoire">
              <Input placeholder="Erreur…" error />
            </FormField>

            <FormField label="Liste déroulante">
              <Select>
                <option>Option 1 : Ben Arous</option>
                <option>Option 2 : Sousse</option>
                <option>Option 3 : Sfax</option>
              </Select>
            </FormField>
          </div>

          <div className="flex items-center gap-6 mt-4 pt-4 border-t border-slate-100">
            <Checkbox label="Autorisation d'ouverture colis" checked onChange={() => {}} />
            <Switch label="Mode Haute Cadence (Scan continu)" checked onChange={() => {}} />
          </div>
        </Card>

        <Card title="3. Toasts &amp; Alertes" subtitle="Déclenchement instantané des notifications de feedback">
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() =>
                addToast({
                  type: 'success',
                  title: 'Opération réussie',
                  message: 'Le colis a été mis à jour.',
                })
              }
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold cursor-pointer"
            >
              Toast Succès
            </button>
            <button
              onClick={() =>
                addToast({
                  type: 'error',
                  title: 'Erreur critique',
                  message: 'Le montant saisi est invalide.',
                })
              }
              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold cursor-pointer"
            >
              Toast Erreur
            </button>
            <button
              onClick={() =>
                addToast({
                  type: 'warning',
                  title: 'Avertissement',
                  message: 'Plafond caisse livreur dépassé.',
                })
              }
              className="px-3 py-1.5 bg-amber-600 hover:amber-700 text-white rounded text-xs font-semibold cursor-pointer"
            >
              Toast Avertissement
            </button>
            <button
              onClick={() =>
                addToast({
                  type: 'info',
                  title: 'Information',
                  message: 'Nouvelle navette Sousse en transit.',
                })
              }
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-semibold cursor-pointer"
            >
              Toast Info
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}

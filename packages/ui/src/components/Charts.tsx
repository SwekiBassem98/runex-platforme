'use client';

import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  LineChart,
  Line,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

export function VolumeLineChart({
  data,
  height = 220,
}: {
  data: { label: string; colis: number; livres: number }[];
  height?: number;
}) {
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
          <XAxis dataKey="label" stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1E293B',
              border: 'none',
              borderRadius: '6px',
              color: '#FFFFFF',
              fontSize: '11px',
            }}
          />
          <Line type="monotone" dataKey="colis" stroke="#64748B" strokeWidth={2} dot={{ r: 3 }} name="Total Pris en Charge" />
          <Line type="monotone" dataKey="livres" stroke="#DC2626" strokeWidth={2} dot={{ r: 3 }} name="Livrés avec Succès" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StatusDonutChart({
  data,
  height = 200,
}: {
  data: { name: string; value: number; color: string }[];
  height?: number;
}) {
  return (
    <div style={{ width: '100%', height }} className="flex items-center justify-center">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            innerRadius={48}
            outerRadius={70}
            paddingAngle={3}
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: '#1E293B',
              border: 'none',
              borderRadius: '6px',
              color: '#FFFFFF',
              fontSize: '11px',
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CodBarChart({
  data,
  height = 220,
}: {
  data: { name: string; aEncaisser: number; encaisse: number }[];
  height?: number;
}) {
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
          <XAxis dataKey="name" stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} />
          <Tooltip
            formatter={(value: any) => [`${Number(value).toFixed(3)} DT`]}
            contentStyle={{
              backgroundColor: '#1E293B',
              border: 'none',
              borderRadius: '6px',
              color: '#FFFFFF',
              fontSize: '11px',
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: '11px', paddingTop: '6px' }}
            formatter={(val) => (val === 'aEncaisser' ? 'Prévu (À encaisser)' : 'Encaissé Espèces')}
          />
          <Bar dataKey="aEncaisser" fill="#94A3B8" radius={[4, 4, 0, 0]} name="aEncaisser" />
          <Bar dataKey="encaisse" fill="#DC2626" radius={[4, 4, 0, 0]} name="encaisse" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DriverActivityChart({
  data,
  height = 220,
}: {
  data: { name: string; livraisons: number; echecs: number }[];
  height?: number;
}) {
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 10, right: 20, left: 30, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F1F5F9" />
          <XAxis type="number" stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} width={100} />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1E293B',
              border: 'none',
              borderRadius: '6px',
              color: '#FFFFFF',
              fontSize: '11px',
            }}
          />
          <Bar dataKey="livraisons" fill="#10B981" radius={[0, 4, 4, 0]} name="Livrés avec succès" />
          <Bar dataKey="echecs" fill="#DC2626" radius={[0, 4, 4, 0]} name="Échecs / Retours" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SupplierActivityChart({
  data,
  height = 220,
}: {
  data: { name: string; colis: number; montantTND: number }[];
  height?: number;
}) {
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
          <XAxis dataKey="name" stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} />
          <Tooltip
            formatter={(value: any, name: any) => [
              name === 'colis' ? `${value} colis` : `${Number(value).toFixed(3)} DT`,
              name === 'colis' ? 'Volume Colis' : 'Montant CRBT',
            ]}
            contentStyle={{
              backgroundColor: '#1E293B',
              border: 'none',
              borderRadius: '6px',
              color: '#FFFFFF',
              fontSize: '11px',
            }}
          />
          <Bar dataKey="colis" fill="#1E293B" radius={[4, 4, 0, 0]} name="colis" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StatBarChart({
  data,
  height = 200,
}: {
  data: { name: string; valeur: number; fill?: string }[];
  height?: number;
}) {
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
          <XAxis dataKey="name" stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1E293B',
              border: 'none',
              borderRadius: '6px',
              color: '#FFFFFF',
              fontSize: '11px',
            }}
          />
          <Bar dataKey="valeur" radius={[4, 4, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.fill || '#DC2626'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

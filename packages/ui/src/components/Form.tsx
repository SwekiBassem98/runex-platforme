'use client';

/**
 * Champs de formulaire.
 *
 * Trois règles tenant dans ce fichier, chacune tirée d'un constat :
 *
 * **Le libellé est rattaché au champ, pas placé à côté.** Sans `htmlFor`, le
 * texte n'est qu'une suite de caractères sur la page : cliquer dessus ne place
 * pas le focus dans le champ, et un lecteur d'écran annonce « champ de texte »
 * sans dire lequel. C'est le défaut d'accessibilité le plus courant, et le moins
 * visible en regardant l'écran.
 *
 * **Un champ qui échoue se dit.** `aria-invalid` et `aria-describedby` font
 * porter par le champ lui-même l'erreur et l'aide, ce qui permet à un lecteur
 * d'écran de les lire sans avoir à deviner laquelle des deux l'intéresse.
 *
 * **La taille de police n'est pas décorative.** Un champ dans lequel on saisit un
 * numéro de téléphone pendant huit heures de suite ne se lit pas en 12 px, et le
 * texte saisi finit par devenir plus grand que ce qu'il remplace à la contraction
 * de la vision. Les champs passent donc en 14 px — le reste de l'interface peut
 * rester dense, parce qu'on la parcourt du regard et qu'on ne la saisit pas.
 */

import React from 'react';
import { useLibellesUI } from '../i18n/LibellesUIProvider';

interface FormFieldProps {
  label?: string;
  error?: string;
  helpText?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
  /** Rend le champ plein largeur. */
  pleineLargeur?: boolean;
}

export function FormField({
  label,
  error,
  helpText,
  required = false,
  children,
  className = '',
  pleineLargeur = false,
}: FormFieldProps) {
  // Le `cloneElement` ne touche qu'un enfant direct, ce qui suffit à tous les
  // usages de l'application et évite d'exiger des identifiants à chaque appel.
  const { libelles } = useLibellesUI();
  const jeton = `champ-${Math.random().toString(36).slice(2, 9)}`;
  const idErreur = `${jeton}-erreur`;
  const idAide = `${jeton}-aide`;

  const enrichi = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        id: (children.props as Record<string, unknown>).id ?? jeton,
        'aria-invalid': error ? true : undefined,
        'aria-describedby':
          [error ? idErreur : null, !error && helpText ? idAide : null]
            .filter(Boolean)
            .join(' ') || undefined,
        'aria-required': required || undefined,
      })
    : children;

  return (
    <div className={`space-y-1.5 ${pleineLargeur ? 'w-full' : ''} ${className}`}>
      {label && (
        <label
          htmlFor={React.isValidElement(children) ? ((children.props as Record<string, unknown>).id as string) ?? jeton : undefined}
          className="block text-xs font-semibold text-slate-700"
        >
          {label}
          {required && (
            <span className="text-red-500 ms-0.5" aria-hidden="true">
              *
            </span>
          )}
          {required && <span className="sr-only">{libelles['form.obligatoire']}</span>}
        </label>
      )}
      {enrichi}
      {error && (
        <p id={idErreur} role="alert" className="text-[11px] text-red-600 font-medium">
          {error}
        </p>
      )}
      {!error && helpText && (
        <p id={idAide} className="text-[11px] text-slate-500 leading-relaxed">
          {helpText}
        </p>
      )}
    </div>
  );
}

/** Base commune : bordure d'erreur, halo de focus, chasse fixe. */
const CHAMP =
  'w-full px-3 py-2 bg-white border rounded-md text-sm text-slate-900 placeholder:text-slate-400 ' +
  'transition-colors focus:outline-none focus:ring-2 ';

const COULEUR_SAIN =
  'border-slate-300 hover:border-slate-400 focus:border-red-600 focus:ring-red-600/20';
const COULEUR_ERREUR =
  'border-red-400 bg-red-50/40 focus:border-red-600 focus:ring-red-600/25';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', error, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={error || undefined}
      className={`${CHAMP} ${error ? COULEUR_ERREUR : COULEUR_SAIN} ${className}`}
      {...props}
    />
  )
);
Input.displayName = 'Input';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = '', error, children, ...props }, ref) => (
    <select
      ref={ref}
      aria-invalid={error || undefined}
      className={`${CHAMP} ${error ? COULEUR_ERREUR : COULEUR_SAIN} cursor-pointer ${className}`}
      {...props}
    >
      {children}
    </select>
  )
);
Select.displayName = 'Select';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = '', error, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={error || undefined}
      className={`${CHAMP} resize-y min-h-20 ${error ? COULEUR_ERREUR : COULEUR_SAIN} ${className}`}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  className = '',
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      className={`inline-flex items-start gap-2 select-none text-xs text-slate-700 ${
        disabled ? 'opacity-50' : 'cursor-pointer'
      } ${className}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 mt-px rounded border-slate-300 text-red-600 accent-red-600 shrink-0 cursor-pointer"
      />
      <span>{label}</span>
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label ?? 'Activer'}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out cursor-pointer ${
          checked ? 'bg-red-600' : 'bg-slate-300'
        }`}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
      {label && <span className="text-xs text-slate-700 font-medium">{label}</span>}
    </span>
  );
}
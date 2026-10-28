import React from 'react';
import { QuickTaskSheet } from './QuickTaskSheet';
import { closeQuickAdd, useQuickAdd } from '../actions';

/**
 * The app-wide "Add a task" sheet, mounted once in the root layout: an app shortcut, a quick-access tile or a widget's
 * link opens it over whatever is showing (openQuickAdd). Each opening is a fresh sheet, on the kind and title it was
 * opened with; it stays mounted while it closes, so its way out and its toast play.
 */
export function QuickAddHost() {
  const { open, kind, title, n } = useQuickAdd();
  if (n === 0) return null;
  return <QuickTaskSheet key={n} visible={open} onClose={closeQuickAdd} initialKind={kind} initialTitle={title} />;
}

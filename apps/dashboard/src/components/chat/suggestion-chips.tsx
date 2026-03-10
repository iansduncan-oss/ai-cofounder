interface SuggestionChipsProps {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
}

export function SuggestionChips({ suggestions, onSelect }: SuggestionChipsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 pl-10">
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          onClick={() => onSelect(suggestion)}
          className="border border-blue-400/40 rounded-full px-3 py-1.5 text-sm text-blue-300 hover:bg-blue-500/10 transition-colors cursor-pointer"
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}

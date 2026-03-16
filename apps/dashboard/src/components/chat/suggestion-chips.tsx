interface SuggestionChipsProps {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
}

export function SuggestionChips({ suggestions, onSelect }: SuggestionChipsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 pl-11">
      {suggestions.map((suggestion) => (
        <button
          key={suggestion}
          onClick={() => onSelect(suggestion)}
          className="border border-purple-400/30 rounded-full px-3.5 py-1.5 text-sm text-purple-300 hover:bg-purple-500/10 hover:border-purple-400/50 hover:shadow-[0_0_12px_rgba(124,58,237,0.15)] transition-all cursor-pointer"
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
}

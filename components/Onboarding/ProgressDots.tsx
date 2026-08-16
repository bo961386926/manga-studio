import React from 'react';
import { TOTAL_PAGES } from './constants';

interface ProgressDotsProps {
  currentPage: number;
  onPageChange: (page: number) => void;
}

const ProgressDots: React.FC<ProgressDotsProps> = ({ currentPage, onPageChange }) => {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: TOTAL_PAGES }, (_, index) => (
        <button
          key={index}
          onClick={() => onPageChange(index)}
          className={`w-2 h-2 rounded-full transition-all duration-300 ${
            index === currentPage
              ? 'bg-white scale-125'
              : 'bg-zinc-600 hover:bg-zinc-500'
          }`}
          aria-label={`跳转到第 ${index + 1} 页`}
        />
      ))}
    </div>
  );
};

export default ProgressDots;

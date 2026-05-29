import React, { createContext, useState, useContext } from 'react';

const FlashingContext = createContext();

export const FlashingProvider = ({ children }) => {
  const [isFlashing, setIsFlashing] = useState(false);

  return (
    <FlashingContext.Provider value={{ isFlashing, setIsFlashing }}>
      {children}
    </FlashingContext.Provider>
  );
};

export const useFlashing = () => {
  const context = useContext(FlashingContext);
  if (context === undefined) {
    throw new Error('useFlashing must be used within a FlashingProvider');
  }
  return context;
};
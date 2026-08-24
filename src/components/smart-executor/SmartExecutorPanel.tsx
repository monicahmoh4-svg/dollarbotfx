import { useState } from 'react';
import SmartExecutorPanel from './SmartExecutorPanel';

const SmartExecutorFab = () => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <>
            <button 
                className='smart-executor-fab'
                onClick={() => setIsOpen(true)}
                title='Open Smart Executor'
                style={{
                    position: 'fixed',
                    bottom: '24px',
                    right: '24px',
                    zIndex: 2147483200,
                    width: '56px',
                    height: '56px',
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                    color: '#fff',
                    border: 'none',
                    boxShadow: '0 4px 12px rgba(99, 102, 241, 0.4)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '24px',
                    transition: 'transform 0.2s ease, box-shadow 0.2s ease'
                }}
                onMouseEnter={e => {
                    e.currentTarget.style.transform = 'scale(1.05)';
                    e.currentTarget.style.boxShadow = '0 6px 16px rgba(99, 102, 241, 0.6)';
                }}
                onMouseLeave={e => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(99, 102, 241, 0.4)';
                }}
            >
                ⚙️
            </button>
            {isOpen && <SmartExecutorPanel onClose={() => setIsOpen(false)} />}
        </>
    );
};

export default SmartExecutorFab;

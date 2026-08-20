  const handleStart = async () => {
    console.log('[PANEL] === STARTING BOT ===');
    console.log('[PANEL] Store keys:', store ? Object.keys(store) : 'NO STORE');
    console.log('[PANEL] Client keys:', client ? Object.keys(client) : 'NO CLIENT');
    
    // Find the real API instance in the store
    let apiInstance: any = null;
    
    if (store) {
      // Try common locations where Deriv App Builder stores the API
      const candidates = [
        store.api,
        store.apiInstance,
        store.derivApi,
        store.client?.api,
        store.client?.apiInstance,
        store.common?.api,
        store.core?.api,
      ];
      
      for (const candidate of candidates) {
        if (candidate && typeof candidate.send === 'function') {
          console.log('[PANEL] ✓ Found API instance at:', candidate === store.api ? 'store.api' : 
                                                    candidate === store.apiInstance ? 'store.apiInstance' :
                                                    candidate === store.derivApi ? 'store.derivApi' :
                                                    candidate === store.client?.api ? 'store.client.api' :
                                                    candidate === store.client?.apiInstance ? 'store.client.apiInstance' :
                                                    candidate === store.common?.api ? 'store.common.api' :
                                                    candidate === store.core?.api ? 'store.core.api' : 'unknown');
          apiInstance = candidate;
          break;
        }
      }
      
      // If not found, do a deep search
      if (!apiInstance) {
        console.log('[PANEL] API not found in common locations, doing deep search...');
        const findApi = (obj: any, path: string = '', depth: number = 0): any => {
          if (!obj || depth > 3) return null;
          if (typeof obj.send === 'function' && typeof obj.connect === 'function') {
            console.log('[PANEL] ✓ Found API at path:', path);
            return obj;
          }
          if (typeof obj === 'object') {
            for (const key in obj) {
              try {
                const found = findApi(obj[key], path ? `${path}.${key}` : key, depth + 1);
                if (found) return found;
              } catch {}
            }
          }
          return null;
        };
        apiInstance = findApi(store);
      }
    }
    
    console.log('[PANEL] Final API instance found:', !!apiInstance);
    
    if (!isLoggedIn) {
      alert('⚠️ Please log in to your Deriv account first (top-right corner)');
      return;
    }
    
    await start({ 
        ...form, 
        currency: sessionCurrency || form.currency,
        client: client,
        apiInstance: apiInstance,  // Pass the real API instance
    });
    setSection('activity');
  };

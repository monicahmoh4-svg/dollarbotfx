// ========================================
// MENU ITEMS
// ========================================
//
// This component has been simplified for white-labeling.
// Third-party developers can add custom menu items here.
//
// Both items below follow the pattern this file already documented
// (MenuItem + leftComponent, from @deriv-com/ui), using onClick instead of
// href since both open a panel rather than navigating.
//
// For mobile menu items, see:
// src/components/layout/header/mobile-menu/use-mobile-menu-config.tsx

import { observer } from 'mobx-react-lite';
import { autoTraderUIStore } from '@/components/autotrader/autotrader-ui-store';
import { freeBotsUIStore } from '@/components/free-bots/free-bots-ui-store';
import { LegacyTargetIcon, LegacyTemplatesIcon } from '@deriv/quill-icons/Legacy';
import { useTranslations } from '@deriv-com/translations';
import { MenuItem, Text } from '@deriv-com/ui';

export const MenuItems = observer(() => {
    const { localize } = useTranslations();

    return (
        <>
            <MenuItem
                as='button'
                className='app-header__menu'
                leftComponent={<LegacyTargetIcon iconSize='sm' />}
                onClick={() => autoTraderUIStore.show()}
            >
                <Text size='sm'>{localize('Autonomous Trading')}</Text>
            </MenuItem>
            <MenuItem
                as='button'
                className='app-header__menu'
                leftComponent={<LegacyTemplatesIcon iconSize='sm' />}
                onClick={() => freeBotsUIStore.show()}
            >
                <Text size='sm'>{localize('Free bots')}</Text>
            </MenuItem>
        </>
    );
});

export const TradershubLink = observer(() => {
    // No default Traders Hub link - add your custom navigation here if needed
    return null;
});

// Create a namespace for MenuItems to include TradershubLink
type MenuItemsType = typeof MenuItems & {
    TradershubLink: typeof TradershubLink;
};

// Assign TradershubLink to MenuItems
(MenuItems as MenuItemsType).TradershubLink = TradershubLink;

export default MenuItems as MenuItemsType;
// [/AI]

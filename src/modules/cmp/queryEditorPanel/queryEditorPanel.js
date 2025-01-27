import { LightningElement, wire } from 'lwc';
import getCaretCoordinates from 'textarea-caret';
import {
    connectStore,
    store,
    executeQuery,
    updateSoql,
    formatSoql
} from '../../store/store';
import { escapeRegExp } from '../../base/utils/regexp-utils';
import { fullApiName, stripNamespace } from '../../service/salesforce';
import { I18nMixin } from '../../i18n/i18n';

export default class QueryEditorPanel extends I18nMixin(LightningElement) {
    isCompletionVisible;
    completionStyle;
    completionFields;
    _sobjectMeta;
    _selectionStart;
    _soql;

    get soql() {
        return this._soql;
    }

    set soql(value) {
        this._soql = value;
        const inputEl = this.template.querySelector('.soql-input');
        if (inputEl) inputEl.value = value;
    }

    @wire(connectStore, { store })
    storeChange({ sobject, ui }) {
        const { query, soql } = ui;
        if (sobject && query) {
            const sobjectState = sobject[fullApiName(query.sObject)];
            if (sobjectState) {
                this._sobjectMeta = sobjectState.data;
            }
        }
        if (soql !== this.soql) {
            this.soql = soql;
        }
    }

    runQuery() {
        this._runQuery();
    }

    runQueryAll() {
        this._runQuery(true);
    }

    formatQuery() {
        store.dispatch(formatSoql());
    }

    insertField(event) {
        const name = event.target.dataset.name;
        if (this._closeCompletionTimer) {
            clearTimeout(this._closeCompletionTimer);
        }
        const selectedField = this.completionFields.find(
            field => field.name === name
        );
        const inputEl = this.template.querySelector('.soql-input');
        this._insertField(inputEl, selectedField);
    }

    handleKeyupSoql(event) {
        const { value } = event.target;
        if (this._soql !== value) {
            store.dispatch(updateSoql(value));
        }

        if (!this._sobjectMeta) return;
        if (!this.isCompletionVisible) {
            this._openCompletion(event);
        } else {
            this._handleCompletion(event);
        }
    }

    handleKeydownSoql(event) {
        const { key, isComposing } = event;
        if (this.isCompletionVisible) {
            if (isComposing) return;
            switch (key) {
                case 'ArrowDown':
                    this._selectBellowField(event);
                    break;
                case 'ArrowUp':
                    this._selectAboveField(event);
                    break;
                case 'Enter':
                    this._insertFieldByKeyboard(event);
                    break;
                default:
                    break;
            }
        } else {
            if (isComposing && key === 'Enter') {
                this._openCompletion(event);
            }
        }
    }

    handleBlurSoql() {
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._closeCompletionTimer = setTimeout(
            () => this._closeCompletion(),
            100
        );
    }

    _runQuery(isAllRows) {
        const input = this.template.querySelector('.soql-input');
        if (!input) return;
        const query = input.value;
        if (!query) return;
        store.dispatch(executeQuery(query, isAllRows));
    }

    _openCompletion(event) {
        const { target } = event;
        this._selectionStart =
            this._findSeparator(
                target.value.substring(0, target.selectionEnd)
            ) || target.selectionEnd;
        if (this._canOpenCompletion(event)) {
            this._searchCompletionFields(event);
        }
    }

    _canOpenCompletion(event) {
        const { key, altKey, ctrlKey, metaKey, isComposing } = event;
        return (
            (ctrlKey && key === ' ') ||
            (key.length === 1 &&
                ![' ', ',', '.'].includes(key) &&
                !altKey &&
                !ctrlKey &&
                !metaKey &&
                !isComposing) ||
            (isComposing && key === 'Enter')
        );
    }

    _findSeparator(value) {
        const result = /[,. ][^,. ]*$/g.exec(value);
        return result && result.index + 1;
    }

    _closeCompletion() {
        this.isCompletionVisible = false;
    }

    _setCompletionPosition(event) {
        const { target } = event;
        const caret = getCaretCoordinates(target, target.selectionStart);
        this.completionStyle = `top:${caret.top + caret.height}px;left:${
            caret.left
        }px;`;
    }

    _searchCompletionFields(event) {
        const { target } = event;
        const keyword = target.value.substring(
            this._selectionStart,
            target.selectionEnd
        );
        const escapedKeyword = escapeRegExp(keyword);
        const keywordPattern = new RegExp(escapedKeyword, 'i');
        this.completionFields = this._sobjectMeta.fields
            .filter(field =>
                keywordPattern.test(`${field.name} ${field.label}`)
            )
            .map((field, index) => {
                return {
                    ...field,
                    itemLabel: `${field.name} / ${field.label}`,
                    isActive: index === 0
                };
            });
        if (this.completionFields.length > 0) {
            this._setCompletionPosition(event);
            this.isCompletionVisible = true;
        } else {
            this.isCompletionVisible = false;
        }
    }

    _handleCompletion(event) {
        const { key, altKey, ctrlKey, metaKey } = event;
        if (altKey || ctrlKey || metaKey) {
            this._closeCompletion();
        }
        switch (key) {
            case '.':
            case ',':
            case ' ':
            case 'Escape':
            case 'ArrowLeft':
            case 'ArrowRight':
                this._closeCompletion();
                break;
            case 'Backspace':
                this._deleteKeyword(event);
                break;
            case 'ArrowDown':
            case 'ArrowUp':
            case 'Enter':
                if (event.isComposing) {
                    this._searchCompletionFields(event);
                }
                break;
            default:
                this._searchCompletionFields(event);
                break;
        }
    }

    _deleteKeyword(event) {
        this._searchCompletionFields(event);
        if (this._selectionStart === event.target.selectionStart) {
            this._closeCompletion();
        }
    }

    _selectBellowField(event) {
        event.preventDefault();
        const activeIndex = this._getActiveFieldIndex();
        if (activeIndex + 1 < this.completionFields.length) {
            this.completionFields = this.completionFields.map(
                (field, index) => {
                    return {
                        ...field,
                        isActive: index === activeIndex + 1
                    };
                }
            );
        }
    }

    _selectAboveField(event) {
        event.preventDefault();
        const activeIndex = this._getActiveFieldIndex();
        if (activeIndex > 0) {
            this.completionFields = this.completionFields.map(
                (field, index) => {
                    return {
                        ...field,
                        isActive: index === activeIndex - 1
                    };
                }
            );
        }
    }

    _getActiveFieldIndex() {
        return this.completionFields.findIndex(field => field.isActive);
    }

    _insertFieldByKeyboard(event) {
        event.preventDefault();
        const selectedField = this.completionFields.find(
            field => field.isActive
        );
        const { target } = event;
        this._insertField(target, selectedField);
    }

    _insertField(textarea, selectedField) {
        if (selectedField) {
            const soql = textarea.value;
            const preSoql = soql.substring(0, this._selectionStart);
            const postSoql = soql.substring(textarea.selectionStart);
            const strippedFieldName = stripNamespace(selectedField.name);
            this.soql = preSoql + strippedFieldName + postSoql;
            const insertedIndex =
                this._selectionStart + strippedFieldName.length;
            textarea.focus();
            textarea.setSelectionRange(insertedIndex, insertedIndex);
            store.dispatch(updateSoql(this.soql));
        }
        this._closeCompletion();
    }
}

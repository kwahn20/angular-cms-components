import {
  Component,
  OnInit,
  Input,
  Output,
  EventEmitter,
  SimpleChanges,
  OnChanges,
  TemplateRef,
} from '@angular/core';
import { kebab } from 'case';
import * as OrderCloudSDK from 'ordercloud-javascript-sdk';
import { PageContentDoc } from '../../models/page-content-doc.interface';
import {
  JDocument,
  ContentManagementClient,
  AssetUpload,
  ListArgs,
  Asset,
  RequiredDeep
} from '@ordercloud/cms-sdk'
import { NgbModalRef, NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { PAGE_SCHEMA } from '../../constants/page-schema.constants';
import { ResourceType } from '../../../shared/models/resource-type.interface';
import { ParentResourceType } from '../../../shared/models/parent-resource-type.interface';
import DEFAULT_ASSET_TYPES, {
  ASSET_TYPES,
} from '../../constants/asset-types.constants';
import { PagePreviewModalComponent } from '../page-preview-modal/page-preview-modal.component';
import * as $ from 'jquery';
import { faQuestionCircle } from '@fortawesome/free-solid-svg-icons';

export const EMPTY_PAGE_CONTENT_DOC: Partial<PageContentDoc> = {
  Title: '',
  MetaTitle: '',
  Url: '',
  Description: '',
  HeaderEmbeds: '',
  Content: ``,
  FooterEmbeds: '',
  Active: false,
  NavigationTitle: '',
};

@Component({
  selector: 'cms-page-editor',
  templateUrl: './page-editor.component.html',
  styleUrls: ['./page-editor.component.scss'],
})
export class PageEditorComponent implements OnInit, OnChanges {
  @Input() document?: JDocument; // required
  @Input() schemaID?: string;
  @Input() renderSiteUrl?: string;
  @Input() editorOptions?: any;
  @Input() resourceType?: ResourceType = null;
  @Input() resourceID?: string = null;
  @Input() parentResourceType?: ParentResourceType = null;
  @Input() parentResourceID?: string = null;
  @Input() lockedSlugs?: string[];
  @Input() requiredSlugs?: string[];
  @Input() usedSlugs?: string[];
  @Input() tagOptions?: string[];
  @Input() assetTypes: ASSET_TYPES[] = DEFAULT_ASSET_TYPES;
  @Input() additionalAssetFilters?: TemplateRef<any>;
  @Input() defaultListOptions?: ListArgs<Asset> = { filters: { Active: true } };
  @Input() beforeAssetUpload?: (asset: AssetUpload) => Promise<AssetUpload>;
  @Input() beforeDocumentSave?: (page: Partial<PageContentDoc>) => Promise<Partial<PageContentDoc>>;
  @Output() selectedAssetChange = new EventEmitter<Asset | Asset[]>();
  @Output() backClicked = new EventEmitter<MouseEvent>();
  @Output() pageSaved = new EventEmitter<JDocument>();
  @Output() pageDeleted = new EventEmitter<string>();

  pageSchemaID: string;
  page: Partial<PageContentDoc>;
  automaticUrl: boolean;
  pageNavigation: boolean;
  confirmModal: NgbModalRef;
  isLoadingSave: boolean;
  selectedTab: string;
  duplicateUrl: boolean;
  isLocked: boolean;
  isRequired: boolean;
  errorMessage: string;
  hasValidEmbeds: boolean;

  faQuestionCircle = faQuestionCircle;

  constructor(private modalService: NgbModal) {}

  ngOnInit(): void {
    if (!this.document) {
      throw new Error(
        'cms-page-editor requires the content document (JDocument) to be edited'
      );
    }
    this.pageSchemaID = this.schemaID || PAGE_SCHEMA.ID;
    if (!this.editorOptions) {
      this.editorOptions = {};
    }
    this.page = Object.assign(
      {},
      this.document ? this.document.Doc : EMPTY_PAGE_CONTENT_DOC
    );
    this.automaticUrl = this.page
      ? this.page.Url === kebab(this.page.Title)
      : true;
    this.pageNavigation = Boolean(this.page ? this.page.NavigationTitle : true);

    this.duplicateUrl = false;
    this.isLocked = this.determineLocked();
    this.isRequired = this.determineRequired();
    this.hasValidEmbeds = this.checkEmbeds();
    this.checkErrorMessage();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Called before any other lifecycle hook. Use it to inject dependencies, but avoid any serious work here.
    // Add '${implements OnChanges}' to the class.
    if (changes.document && !changes.document.firstChange) {
      this.ngOnInit();
    } else {
      if (changes.lockedSlugs && !changes.lockedSlugs.firstChange) {
        this.isLocked = this.determineLocked();
      }

      if (changes.requiredSlugs && !changes.requiredSlugs.firstChange) {
        this.isRequired = this.determineRequired();
      }
      this.checkErrorMessage();
    }
  }

  onPageContentChange(html: string): void {
    this.page = { ...this.page, Content: html };
  }

  openPreviewModal(): Promise<any> {
    const modalRef = this.modalService.open(PagePreviewModalComponent, {
      size: 'xxl',
      centered: false,
      backdropClass: 'oc-tinymce-modal_backdrop',
      windowClass: 'oc-tinymce-modal_window',
    });
    modalRef.componentInstance.html = this.page.Content;
    modalRef.componentInstance.remoteCss = this.editorOptions?.content_css[0];
    return modalRef.result;
  }

  onPageTitleKeyUp(value: string): void {
    if (this.automaticUrl && !this.isLocked) {
      this.page.Url = kebab(value);
      this.onPageUrlKeyUp();
    }
    this.checkErrorMessage();
  }

  onPageMetaTitleChange(): void {
    this.checkErrorMessage();
  }

  onAutomaticUrlChange(): void {
    if (this.automaticUrl && this.page.Title) {
      this.page.Url = kebab(this.page.Title);
      this.onPageUrlKeyUp();
    }
    this.checkErrorMessage();
  }

  onPageUrlKeyUp(): void {
    this.duplicateUrl = this.usedSlugs
      ? this.usedSlugs.includes(this.page.Url)
      : false;
  }

  onPageUrlChange() {
    this.page.Url = kebab(this.page.Url);
    this.onPageUrlKeyUp();
    this.checkErrorMessage();
  }

  onEmbedsChange() {
    this.hasValidEmbeds = this.checkEmbeds();
  }

  onPageNavigationChange(): void {
    if (this.pageNavigation && !this.page.NavigationTitle) {
      this.page.NavigationTitle = this.page.Title;
    } else {
      this.page.NavigationTitle = '';
    }
  }

  onPageStatusChange(): void {
    this.page.Active = !this.page.Active;
  }

  onPageIndexingChange(): void {
    this.page.NoRobotsIndexing = !this.page.NoRobotsIndexing;
  }

  async onSubmit(): Promise<void> {
    this.isLoadingSave = true;
    const updated = await this.saveChanges().finally(
      () => (this.isLoadingSave = false)
    );
    this.pageSaved.emit(updated);
  }

  async saveChanges(): Promise<RequiredDeep<JDocument>> {
    if (this.beforeDocumentSave) {
      return this.beforeDocumentSave(this.page).then(async (page) => {
        this.document.Doc = page;
        return await this.saveDocument(this.document);
      });
    } else {
      return await this.saveDocument(this.document);
    }
  }

  async saveDocument(document): Promise<RequiredDeep<JDocument>> {
    const me = await OrderCloudSDK.Me.Get();
    const nowDate = new Date().toISOString();
    const fullName = `${me.FirstName} ${me.LastName}`;
    let updated: RequiredDeep<JDocument>;
    if (document && document.ID) {
      updated = await ContentManagementClient.Documents.Save(
        this.pageSchemaID,
        document.ID,
        {
          ID: document.ID,
          Doc: {
            ...this.page,
            DateLastUpdated: nowDate,
            LastUpdatedBy: fullName,
          },
        }
      );
    } else {
      updated = await ContentManagementClient.Documents.Create(this.pageSchemaID, {
        Doc: {
          ...this.page,
          Author: fullName,
          DateCreated: nowDate,
          DateLastUpdated: nowDate,
          LastUpdatedBy: fullName,
        },
      });
    }

    if (this.resourceType && this.resourceID) {
      await ContentManagementClient.Documents.SaveAssignment(this.pageSchemaID, {
        ResourceID: this.resourceID,
        ResourceType: this.resourceType,
        ParentResourceID: this.parentResourceID,
        ParentResourceType: this.parentResourceType,
        DocumentID: updated.ID,
      });
    }

    return updated;
  }

  async onDelete(): Promise<void> {
    if (this.resourceType && this.resourceID) {
      await ContentManagementClient.Documents.DeleteAssignment(
        this.pageSchemaID,
        this.document.ID,
        this.resourceID,
        this.resourceType,
        this.parentResourceID,
        this.parentResourceType
      );
    }
    await ContentManagementClient.Documents.Delete(this.pageSchemaID, this.document.ID);
    this.pageDeleted.emit(this.document.ID);
    this.confirmModal.close();
  }

  confirmDeletePage(confirmModalTemplate): void {
    this.confirmModal = this.modalService.open(confirmModalTemplate);
  }

  determineLocked(): boolean {
    return (
      this.lockedSlugs &&
      this.document.ID &&
      this.lockedSlugs.includes(this.document.Doc.Url)
    );
  }

  determineRequired(): boolean {
    return (
      this.requiredSlugs &&
      this.document.ID &&
      this.requiredSlugs.includes(this.document.Doc.Url)
    );
  }

  hasChanges(): boolean {
    return JSON.stringify(this.document.Doc) !== JSON.stringify(this.page);
  }

  checkErrorMessage() {
    if (!this.page) {
      this.errorMessage = undefined;
    } else if (!this.page.Title) {
      this.errorMessage = 'Settings > Page Title is required';
    } else if (!this.page.MetaTitle) {
      this.errorMessage = 'SEO > Meta Title is required';
    } else if (this.duplicateUrl) {
      this.errorMessage = 'The selected URL is already in use.';
    } else {
      this.errorMessage = undefined;
    }
  }

  isValid(): boolean {
    return Boolean(
      this.page.Title &&
        this.page.MetaTitle &&
        (this.page.Url || this.isLocked) &&
        ((this.page.Active && this.isRequired) || !this.isRequired) &&
        !this.duplicateUrl &&
        this.hasValidEmbeds
    );
  }

  private checkEmbeds(): boolean {
    if (!this.page.HeaderEmbeds && !this.page.FooterEmbeds) return true;

    const embeds = ['HeaderEmbeds', 'FooterEmbeds'];
    let hasValidTags = true;
    let element;
    let isMissingClosingTagsMsg;
    embeds.forEach((embed) => {
      const content = this.page[embed];
      if (content) {
        try {
          element = $(content);
        } catch {
          // catch syntax err
          hasValidTags = false;
          return;
        }

        // do no allow plain text for both header and footer embeds
        // all content should begin with < (even if they want to add comments)
        if (element.length === 0 || content.trim()[0] !== '<') {
          hasValidTags = false;
          return;
        }

        element.each(function () {
          if (embed === 'FooterEmbeds') {
            // if non SCRIPT tags are added to the footer embed, it will break the page
            // therefore, only allow script tags to be used in the footer
            if (this.tagName !== 'SCRIPT') hasValidTags = false;
          }
        });
        // confirm all non self closing tags are closed
        if (hasValidTags)
          isMissingClosingTagsMsg = this.checkForClosingTags(content, embed);
      }
    });
    this.errorMessage = !!isMissingClosingTagsMsg
      ? isMissingClosingTagsMsg
      : !hasValidTags
      ? 'Please review the supported content for the header and footer embeds'
      : undefined;
    return hasValidTags && !isMissingClosingTagsMsg;
  }

  private checkForClosingTags(content: string, embed: string): string {
    let openingTags = [];
    let tagsArray = [];
    const lines = content.split('\n');
    lines.forEach((line: string) => {
      tagsArray = line.match(
        /<(\/{1})?\w+((\s+\w+(\s*=\s*(?:".*?"|'.*?'|[^'">\s]+))?)+\s*|\s*)>/g
      );
      if (tagsArray) {
        tagsArray.forEach((currentTag: string) => {
          const isClosingTag = currentTag.indexOf('</') >= 0;
          if (isClosingTag) {
            let closingTag = currentTag.substr(2, currentTag.length - 3);
            closingTag = closingTag.replace(/ /g, '');
            for (var j = openingTags.length - 1; j >= 0; j--) {
              if (openingTags[j] == closingTag) {
                openingTags.splice(j, 1);
                if (closingTag != 'html') {
                  break;
                }
              }
            }
          } else {
            let tag = currentTag;
            const length =
              tag.indexOf(' ') > 0 ? tag.indexOf(' ') - 1 : tag.length - 2;
            tag = currentTag.substr(1, length);
            const selfClosingTags = [
              'area',
              'base',
              'br',
              'col',
              'command',
              'embed',
              'hr',
              'img',
              'input',
              'keygen',
              'link',
              'meta',
              'param',
              'source',
              'track',
              'wbr',
            ];
            let isSelfClosing = false;
            selfClosingTags.forEach((selfClosingTag) => {
              if (selfClosingTag.includes(tag)) isSelfClosing = true;
            });
            if (!isSelfClosing) {
              openingTags.push(tag);
            }
          }
        });
      }
    });

    let message: string;
    if (openingTags.length > 0) {
      message = `The following tags don't seem to be closed in the ${embed
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLocaleLowerCase()}: `;
      let tags = [];
      tags = openingTags.map((element) => `<${element}>`);
      const stringifyTagsArray = tags.join(', ');
      message = message.concat(stringifyTagsArray);
    }
    return message;
  }
}

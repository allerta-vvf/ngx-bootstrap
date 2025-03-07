import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  OnDestroy,
  OnInit,
  Renderer2,
  ViewChild
} from '@angular/core';

import { take } from 'rxjs/operators';
import { Subscription } from 'rxjs';

import { getFullYear, getMonth } from 'ngx-bootstrap/chronos';
import { PositioningService } from 'ngx-bootstrap/positioning';
import { TimepickerComponent } from 'ngx-bootstrap/timepicker';

import { BsDatepickerAbstractComponent } from '../../base/bs-datepicker-container';
import { BsDatepickerConfig } from '../../bs-datepicker.config';
import { CalendarCellViewModel, DayViewModel } from '../../models';
import { BsDatepickerActions } from '../../reducer/bs-datepicker.actions';
import { BsDatepickerEffects } from '../../reducer/bs-datepicker.effects';
import { BsDatepickerStore } from '../../reducer/bs-datepicker.store';
import { datepickerAnimation } from '../../datepicker-animations';
import { BsCustomDates } from './bs-custom-dates-view.component';
import { dayInMilliseconds } from '../../reducer/_defaults';

@Component({
  selector: 'bs-daterangepicker-container',
  providers: [BsDatepickerStore, BsDatepickerEffects],
  templateUrl: './bs-datepicker-view.html',
  host: {
    class: 'bottom',
    '(click)': '_stopPropagation($event)',
    role: 'dialog',
    'aria-label': 'calendar'
  },
  animations: [datepickerAnimation]
})
export class BsDaterangepickerContainerComponent extends BsDatepickerAbstractComponent
  implements OnInit, OnDestroy, AfterViewInit {

  set value(value: (Date|undefined)[] | undefined) {
    this._effects?.setRangeValue(value);
  }

  valueChange = new EventEmitter<Date[]>();
  animationState = 'void';

  _rangeStack: Date[] = [];
  override chosenRange: Date[] = [];
  _subs: Subscription[] = [];
  override isRangePicker = true;

  @ViewChild('startTP') startTimepicker?: TimepickerComponent;
  @ViewChild('endTP') endTimepicker?: TimepickerComponent;

  constructor(
    _renderer: Renderer2,
    private _config: BsDatepickerConfig,
    private _store: BsDatepickerStore,
    private _element: ElementRef,
    private _actions: BsDatepickerActions,
    _effects: BsDatepickerEffects,
    private _positionService: PositioningService
  ) {
    super();
    this._effects = _effects;

    this.customRanges = this._config.ranges || [];
    this.customRangeBtnLbl = this._config.customRangeButtonLabel;

    _renderer.setStyle(_element.nativeElement, 'display', 'block');
    _renderer.setStyle(_element.nativeElement, 'position', 'absolute');
  }

  ngOnInit(): void {
    this._positionService.setOptions({
      modifiers: { flip: { enabled: this._config.adaptivePosition } },
      allowedPositions: ['top', 'bottom']
    });

    this._positionService.event$?.pipe(take(1))
      .subscribe(() => {
        this._positionService.disable();

        if (this._config.isAnimated) {
          this.animationState = this.isTopPosition ? 'animated-up' : 'animated-down';

          return;
        }

        this.animationState = 'unanimated';
      });
    this.containerClass = this._config.containerClass;
    this.isOtherMonthsActive = this._config.selectFromOtherMonth;
    this.withTimepicker = this._config.withTimepicker;
    this.timePickerMedidian = this._config.timePickerMedidian;
    this._effects?.init(this._store)
      // intial state options
      // todo: fix this, split configs
      .setOptions(this._config)
      // data binding view --> model
      .setBindings(this)
      // set event handlers
      .setEventHandlers(this)
      .registerDatepickerSideEffects();

    // todo: move it somewhere else
    // on selected date change
    this._subs.push(
      this._store
        .select(state => state.selectedRange)
        .subscribe(dateRange => {
          this.valueChange.emit(dateRange);
          this.chosenRange = dateRange || [];
        })
    );
  }

  ngAfterViewInit(): void {
    this.selectedTimeSub.add(this.selectedTime?.subscribe((val) => {
      if (Array.isArray(val) && val.length >= 2) {
        this.startTimepicker?.writeValue(val[0]);
        this.endTimepicker?.writeValue(val[1]);
      }
    }));
    this.startTimepicker?.registerOnChange((val) => {
      this.timeSelectHandler(val, 0);
    });
    this.endTimepicker?.registerOnChange((val) => {
      this.timeSelectHandler(val, 1);
    });
  }

  get isTopPosition(): boolean {
    return this._element.nativeElement.classList.contains('top');
  }

  positionServiceEnable(): void {
    this._positionService.enable();
  }

  override timeSelectHandler(date: Date, index: number): void {
    this._store.dispatch(this._actions.selectTime(date, index));
  }

  override daySelectHandler(day: DayViewModel): void {
    if (!day) {
      return;
    }
    const isDisabled = this.isOtherMonthsActive ? day.isDisabled : (day.isOtherMonth || day.isDisabled);

    if (isDisabled) {
      return;
    }
    this.rangesProcessing(day);
  }

  override monthSelectHandler(day: CalendarCellViewModel): void {
    if (!day || day.isDisabled) {
      return;
    }

    day.isSelected = true;

    if (this._config.minMode !== 'month') {
      if (day.isDisabled) {
        return;
      }
      this._store.dispatch(
        this._actions.navigateTo({
          unit: {
            month: getMonth(day.date),
            year: getFullYear(day.date)
          },
          viewMode: 'day'
        })
      );

      return;
    }
    this.rangesProcessing(day);
  }

  override yearSelectHandler(day: CalendarCellViewModel): void {
    if (!day || day.isDisabled) {
      return;
    }

    day.isSelected = true;

    if (this._config.minMode !== 'year') {
      if (day.isDisabled) {
        return;
      }
      this._store.dispatch(
        this._actions.navigateTo({
          unit: {
            year: getFullYear(day.date)
          },
          viewMode: 'month'
        })
      );

      return;
    }
    this.rangesProcessing(day);
  }

  rangesProcessing(day: CalendarCellViewModel): void {
    // if only one date is already selected
    // and user clicks on previous date
    // start selection from new date
    // but if new date is after initial one
    // than finish selection

    if (this._rangeStack.length === 1) {
      this._rangeStack =
        day.date >= this._rangeStack[0]
          ? [this._rangeStack[0], day.date]
          :  [day.date];
    }

    if (this._config.maxDateRange) {
      this.setMaxDateRangeOnCalendar(day.date);
    }

    if (this._rangeStack.length === 0) {
      this._rangeStack = [day.date];

      if (this._config.maxDateRange) {
        this.setMaxDateRangeOnCalendar(day.date);
      }
    }

    this._store.dispatch(this._actions.selectRange(this._rangeStack));

    if (this._rangeStack.length === 2) {
      this._rangeStack = [];
    }
  }

  ngOnDestroy(): void {
    for (const sub of this._subs) {
      sub.unsubscribe();
    }
    this.selectedTimeSub.unsubscribe();
    this._effects?.destroy();
  }

  override setRangeOnCalendar(dates: BsCustomDates): void {
    if (dates) {
      this._rangeStack = dates.value instanceof Date ? [dates.value] : dates.value;
    }
    this._store.dispatch(this._actions.selectRange(this._rangeStack));
  }

  setMaxDateRangeOnCalendar(currentSelection: Date): void {
    let maxDateRange = new Date(currentSelection);

    if (this._config.maxDate) {
      const maxDateValueInMilliseconds = this._config.maxDate.getTime();
      const maxDateRangeInMilliseconds = currentSelection.getTime() + ((this._config.maxDateRange || 0) * dayInMilliseconds );
      maxDateRange = maxDateRangeInMilliseconds > maxDateValueInMilliseconds ?
        new Date(this._config.maxDate) :
        new Date(maxDateRangeInMilliseconds);
    } else {
      maxDateRange.setDate(currentSelection.getDate() + (this._config.maxDateRange || 0));
    }

    this._effects?.setMaxDate(maxDateRange);
  }
}

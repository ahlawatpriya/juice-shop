import { Component, NgZone, type OnDestroy, type OnInit } from '@angular/core'
import { ActivatedRoute, Router } from '@angular/router'
import { DomSanitizer } from '@angular/platform-browser'
import { MatDialog } from '@angular/material/dialog'
import { type Subscription, combineLatest } from 'rxjs'

import { fromQueryParams, toQueryParams } from './filter-settings/query-params-converters'
import { DEFAULT_FILTER_SETTING, type FilterSetting } from './filter-settings/FilterSetting'
import { type Config, ConfigurationService } from '../Services/configuration.service'
import { CodeSnippetComponent } from '../code-snippet/code-snippet.component'
import { ChallengeService } from '../Services/challenge.service'
import { filterChallenges } from './helpers/challenge-filtering'
import { SocketIoService } from '../Services/socket-io.service'
import { type EnrichedChallenge } from './types/EnrichedChallenge'
import { sortChallenges } from './helpers/challenge-sorting'
import { TranslateModule } from '@ngx-translate/core'
import { ChallengeCardComponent } from './components/challenge-card/challenge-card.component'
import { TutorialModeWarningComponent } from './components/tutorial-mode-warning/tutorial-mode-warning.component'
import { ChallengesUnavailableWarningComponent } from './components/challenges-unavailable-warning/challenges-unavailable-warning.component'
import { MatProgressSpinner } from '@angular/material/progress-spinner'
import { FilterSettingsComponent } from './components/filter-settings/filter-settings.component'
import { NgIf, NgFor, NgClass } from '@angular/common'
import { DifficultyOverviewScoreCardComponent } from './components/difficulty-overview-score-card/difficulty-overview-score-card.component'
import { CodingChallengeProgressScoreCardComponent } from './components/coding-challenge-progress-score-card/coding-challenge-progress-score-card.component'
import { HackingChallengeProgressScoreCardComponent } from './components/hacking-challenge-progress-score-card/hacking-challenge-progress-score-card.component'

interface ChallengeSolvedWebsocket {
  key: string
  name: string
  challenge: string
  flag: string
  hidden: boolean
  isRestore: boolean
}
interface CodeChallengeSolvedWebsocket {
  key: string
  codingChallengeStatus: 0 | 1 | 2
}

@Component({
  selector: 'app-score-board',
  templateUrl: './score-board.component.html',
  styleUrls: ['./score-board.component.scss'],
  imports: [HackingChallengeProgressScoreCardComponent, CodingChallengeProgressScoreCardComponent, DifficultyOverviewScoreCardComponent, NgIf, FilterSettingsComponent, MatProgressSpinner, ChallengesUnavailableWarningComponent, TutorialModeWarningComponent, NgFor, ChallengeCardComponent, NgClass, TranslateModule]
})
export class ScoreBoardComponent implements OnInit, OnDestroy {
  public allChallenges: EnrichedChallenge[] = []
  public filteredChallenges: EnrichedChallenge[] = []
  public filterSetting: FilterSetting = structuredClone(DEFAULT_FILTER_SETTING)
  public applicationConfiguration: Config | null = null

  public isInitialized: boolean = false

  private readonly subscriptions: Subscription[] = []

  constructor (
    private readonly challengeService: ChallengeService,
    private readonly configurationService: ConfigurationService,
    private readonly sanitizer: DomSanitizer,
    private readonly ngZone: NgZone,
    private readonly io: SocketIoService,
    private readonly dialog: MatDialog,
    private readonly router: Router,
    private readonly route: ActivatedRoute
  ) { }

  ngOnInit (): void {
    const dataLoaderSubscription = combineLatest([
      this.challengeService.find({ sort: 'name' }),
      this.configurationService.getApplicationConfiguration()
    ]).subscribe(([challenges, applicationConfiguration]) => {
      this.applicationConfiguration = applicationConfiguration

      const transformedChallenges = challenges.map((challenge) => {
        return {
          ...challenge,
          tagList: challenge.tags ? challenge.tags.split(',').map((tag) => tag.trim()) : [],
          originalDescription: challenge.description as string,
          description: this.sanitizer.bypassSecurityTrustHtml(challenge.description as string)
        }
      })

      this.allChallenges = transformedChallenges
      this.filterAndUpdateChallenges()
      this.isInitialized = true
    })
    this.subscriptions.push(dataLoaderSubscription)

    const routerSubscription = this.route.queryParams.subscribe((queryParams) => {
      this.filterSetting = fromQueryParams(queryParams)
      this.filterAndUpdateChallenges()
    })
    this.subscriptions.push(routerSubscription)

    this.io.socket().on('challenge solved', this.onChallengeSolvedWebsocket.bind(this))
    this.io.socket().on('code challenge solved', this.onCodeChallengeSolvedWebsocket.bind(this))
  }

  ngOnDestroy (): void {
    this.io.socket().off('challenge solved', this.onChallengeSolvedWebsocket.bind(this))
    this.io.socket().off('code challenge solved', this.onCodeChallengeSolvedWebsocket.bind(this))
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe()
    }
  }

  onFilterSettingUpdate (filterSetting: FilterSetting) {
    this.router.navigate([], {
      queryParams: toQueryParams(filterSetting)
    })
  }

  onChallengeSolvedWebsocket (data?: ChallengeSolvedWebsocket) {
    if (!data) {
      return
    }

    this.allChallenges = this.allChallenges.map((challenge) => {
      if (challenge.key === data.key) {
        return {
          ...challenge,
          solved: true
        }
      }
      return { ...challenge }
    })
    this.filterAndUpdateChallenges()
    // manually trigger angular change detection... :(
    // unclear why this is necessary, possibly because the socket.io callback is not running inside angular
    this.ngZone.run(() => {})
  }

  onCodeChallengeSolvedWebsocket (data?: CodeChallengeSolvedWebsocket) {
    if (!data) {
      return
    }

    this.allChallenges = this.allChallenges.map((challenge) => {
      if (challenge.key === data.key) {
        return {
          ...challenge,
          codingChallengeStatus: data.codingChallengeStatus
        }
      }
      return { ...challenge }
    })
    this.filterAndUpdateChallenges()
    // manually trigger angular change detection... :(
    // unclear why this is necessary, possibly because the socket.io callback is not running inside angular
    this.ngZone.run(() => {})
  }

  filterAndUpdateChallenges (): void {
    this.filteredChallenges = sortChallenges(
      filterChallenges(this.allChallenges, {
        ...this.filterSetting,
        restrictToTutorialChallengesFirst: this.applicationConfiguration?.challenges?.restrictToTutorialsFirst ?? true
      })
    )
  }

  // angular helper to speed up challenge rendering
  getChallengeKey (index: number, challenge: EnrichedChallenge): string {
    return challenge.key
  }

  reset () {
    this.router.navigate([], {
      queryParams: toQueryParams(DEFAULT_FILTER_SETTING)
    })
  }

  openCodingChallengeDialog (challengeKey: string) {
    const challenge = this.allChallenges.find((challenge) => challenge.key === challengeKey)

    this.dialog.open(CodeSnippetComponent, {
      disableClose: true,
      data: {
        key: challengeKey,
        name: challenge.name,
        codingChallengeStatus: challenge.codingChallengeStatus
      }
    })
  }

  async repeatChallengeNotification (challengeKey: string) {
    const challenge = this.allChallenges.find((challenge) => challenge.key === challengeKey)
    await this.challengeService.repeatNotification(encodeURIComponent(challenge.name)).toPromise()
  }
}

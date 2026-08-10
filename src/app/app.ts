import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TelemetryBar } from './shared/telemetry-bar/telemetry-bar';
import { ThemeToggle } from './shared/theme-toggle/theme-toggle';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TelemetryBar, ThemeToggle],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
